// 编排器(v2 核心):显式状态机 + 单长驻异步循环串行队列 + 世代计数器。
//
// 状态:'idle'(控制权在用户)| 'baton'(接棒自由讨论)| 'roundrobin'(@allN 执行中)
//
// v1 教训(本文件的设计全部由此推导,勿改):
//  - v1 用 6 个互锁标志位隐式表达状态 → pendingBaton 死锁、双触发、状态残留三类事故
//  - v1 队列是链式 .then(run,run):两个快速入队可在微任务级联中并发穿透 → 双进程
//  - v1 stop 后 status!=='error' 判断放行 → 半截垃圾消息落库
//  - v1 resume 失败无自愈 → 本房间后续发言永久失败
//
// v2 构造性防御:
//  - 队列唯一消费者:一个长驻 async 循环,物理上无并发窗口
//  - 世代计数器:stop/@allN/@name 都 bump generation,过期条目 dequeue 即丢弃
//  - 接棒解析只在 invoke 尾部发生,且校验"发言开始时的世代 == 当前世代"
//    (进行中发言不会被中途到达的新指令窃取接棒决策权)
//  - error → 一律 idle,绝不从错误文本解析接棒
//  - cancelled → 跳过落库跳过接棒

import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentEvent, SpeakOutcome } from '../adapters/base';
import { buildPrompt, parseBaton, matchMemberByName } from './prompt';
import type { ChatMessage, MemberConfig, MemberStatus, RoomConfig, OrchestrationState } from './types';

/** 适配器注册表抽象(测试注入 fake 的接缝) */
export type AdapterResolver = (adapterKey: string) => AgentAdapter;

export interface OrchestratorDeps {
  room: RoomConfig;                    // 房间配置(可变引用:成员/设置运行期改)
  adapterConfigs: Record<string, { command: string; args: string[] }>;
  resolveAdapter: AdapterResolver;
  /** 消息出口:落库+广播(由 ChatRoom 提供) */
  pushMessage: (msg: ChatMessage) => Promise<void>;
  /** 系统消息便捷出口 */
  sysMessage: (text: string) => Promise<void>;
  /** 成员状态快照变更(广播 roomState) */
  onStatuses: () => void;
  /** rooms.json 写穿(成员消息完成后;带最新 sessionIds) */
  persistRoom: () => Promise<void>;
  /** Scout 预检:返回侦察消息(若该跑) */
  runScout: () => Promise<ChatMessage | null>;
  /** 聊天历史快照(prompt 组装用) */
  getHistory: () => ChatMessage[];
  /** 适配器事件转发(WS 实时流) */
  pushAgentEvent: (ev: AgentEvent) => void;
}

/** 队列条目 */
interface SpeechEntry {
  memberId: string;
  trigger?: string;
  instruction?: string;
  /** 入队时的世代;dequeue 时 ≠ 当前世代 → 丢弃 */
  generation: number;
  /** 接棒条目:发言结束后解析尾行决定下一位 */
  baton?: boolean;
  /** @allN 条目跑完后的终局动作 */
  afterRounds?: 'finalSummary';
}

const PALETTE = [
  '#5B8DEF', '#8E7CC3', '#4CAF7D', '#E0915B',
  '#D46A9E', '#6ABFC3', '#C3A96A', '#9BA65D',
];

export class Orchestrator {
  state: OrchestrationState = 'idle';
  statuses: Record<string, MemberStatus> = {};
  currentSpeaker: string | undefined;

  private queue: SpeechEntry[] = [];
  private generation = 0;
  private budget: number;
  private fairCursor = 0;
  private lastSpeakAt: Record<string, number> = {};
  private loopRunning = false;
  private cancelCurrent: (() => void) | null = null;

  constructor(private deps: OrchestratorDeps) {
    this.budget = deps.room.chainBudget;
    for (const m of deps.room.members) this.statuses[m.id] = 'idle';
  }

  /** 新成员加入(房间门面调用) */
  memberAdded(member: MemberConfig): void {
    this.statuses[member.id] = 'idle';
    this.onStatuses();
  }

  /** 成员移除:状态清除 + 队列中该成员的条目一并移除(队列归编排器所有,防御内聚于此) */
  memberRemoved(memberId: string): void {
    delete this.statuses[memberId];
    delete this.lastSpeakAt[memberId];
    this.queue = this.queue.filter((e) => e.memberId !== memberId);
    if (this.currentSpeaker === memberId) this.cancelCurrent?.();
    this.onStatuses();
  }

  private onStatuses(): void {
    this.deps.onStatuses();
  }

  private setState(s: OrchestrationState): void {
    this.state = s;
    this.onStatuses();
  }

  private bumpGeneration(): void {
    this.generation++;
    this.queue = []; // 旧世代条目全部作废,不必等 dequeue
  }

  private enqueue(entry: Omit<SpeechEntry, 'generation'>): void {
    this.queue.push({ ...entry, generation: this.generation });
    this.kickLoop();
  }

  // ---------- 长驻串行循环(唯一消费者,物理上无并发窗口) ----------

  private kickLoop(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    void this.loop();
  }

  private async loop(): Promise<void> {
    try {
      for (;;) {
        const entry = this.queue.shift();
        if (!entry) break;
        // 世代过期 → 丢弃(stop/@allN/@name 已宣布新秩序)
        if (entry.generation !== this.generation) continue;
        // 幽灵成员防御(已移除/适配器未配置)
        const member = this.deps.room.members.find((m) => m.id === entry.memberId);
        if (!member) continue;
        await this.runOne(member, entry);
      }
    } finally {
      this.loopRunning = false;
    }
  }

  // ---------- 用户入口(全部由 ChatRoom 转发) ----------

  /** 用户消息(已入库):解析 @指令并驱动状态机。 */
  async onUserMessage(text: string): Promise<void> {
    const cmd = this.parseUserCommand(text);
    const members = this.deps.room.members;

    switch (cmd.kind) {
      case 'mention': {
        // 点名 = 一问一答:bump 世代取消一切未开始条目(含旧 @name),单答入队,答完回 idle
        this.bumpGeneration();
        this.cancelCurrent?.();
        this.state = 'idle'; // 不进入 baton/roundrobin;答完留在 idle
        this.onStatuses();
        if (cmd.member) {
          this.sysNotice(`已取消之前的指令,@${cmd.member.name} 将回答你`);
          this.enqueue({
            memberId: cmd.member.id,
            trigger: '用户在聊天中 @了你,请回应用户的问题。回答完即止,不要向其他人传棒。',
          });
        } else {
          this.sysNotice(`没有找到 @ 的成员,控制权回到你手里`);
        }
        return;
      }
      case 'all': {
        // 轮流 N 轮:bump 世代,预入队全部条目(辩手×N轮 + 轮末小结 + 终局总结)
        this.bumpGeneration();
        this.cancelCurrent?.();
        this.startRoundRobin(cmd.rounds);
        return;
      }
      case 'none':
      default: {
        // 纯文本:激活/维持接棒模式,预算重置
        this.budget = this.deps.room.chainBudget;
        if (this.state === 'idle' && members.length > 0 && this.currentSpeaker == null) {
          // 冷启动:选一位起头
          this.setState('baton');
          const first = members[0]!;
          this.enqueue({
            memberId: first.id,
            trigger: '讨论开始,请你先就主题开个头。',
            baton: true,
          });
        } else if (this.state === 'baton' && this.currentSpeaker == null && this.queue.length === 0) {
          // 冷场补救:没人在说、队列空(上次没写接棒行已回 idle,不该到这里;防御性保留)
          this.pickAndEnqueue(null);
        }
        return;
      }
    }
  }

  /** 停止按钮:bump 世代 + 杀当前进程 → idle */
  async stop(): Promise<void> {
    this.bumpGeneration();
    this.cancelCurrent?.();
    this.setState('idle');
  }

  /** 用户给成员直接下指令(一问一答,同 @点名语义) */
  directInstruction(memberId: string, userText: string): void {
    this.bumpGeneration();
    this.cancelCurrent?.();
    this.state = 'idle';
    this.onStatuses();
    this.enqueue({
      memberId,
      trigger: `用户(房间主人)直接对你说:${userText}`,
    });
  }

  // ---------- @allN 轮流(预入队全部条目) ----------

  private startRoundRobin(rounds: number): void {
    const speakers = this.deps.room.members.filter((m) => m.id !== this.deps.room.moderatorId);
    const moderator = this.deps.room.members.find((m) => m.id === this.deps.room.moderatorId);
    this.setState('roundrobin');
    if (speakers.length === 0 && moderator) {
      // 只有主持人:每轮自问自答
      for (let r = 1; r <= rounds; r++) {
        this.enqueue({ memberId: moderator.id, trigger: this.moderatorSelfTrigger(r) });
      }
      this.enqueue({ memberId: moderator.id, trigger: this.finalTrigger(), afterRounds: 'finalSummary' });
      return;
    }
    for (let r = 1; r <= rounds; r++) {
      speakers.forEach((m, i) => {
        this.enqueue({ memberId: m.id, trigger: this.turnTrigger(r, i, speakers.length) });
      });
      if (moderator) {
        this.enqueue({ memberId: moderator.id, trigger: this.moderatorSummaryTrigger(r) });
      }
    }
    const summarizer = moderator ?? speakers[speakers.length - 1]!;
    this.enqueue({ memberId: summarizer.id, trigger: this.finalTrigger(), afterRounds: 'finalSummary' });
    void this.sysMessage(`开始轮流发言 ${rounds} 轮`);
  }

  private turnTrigger(roundNo: number, posInRound: number, total: number): string {
    const first = roundNo === 1 && posInRound === 0;
    if (posInRound === total - 1 && roundNo > 1) {
      return `这是第 ${roundNo} 轮的收尾发言。针对前面发言者的观点进行回应、反驳或补充。`;
    }
    return `这是第 ${roundNo} 轮发言。${first ? '请先亮明你的立场。' : '针对前面发言者的观点进行回应、反驳或补充。'}`;
  }

  private moderatorSummaryTrigger(roundNo: number): string {
    return `你是主持人。第 ${roundNo} 轮结束,请用两三句话小结分歧焦点,并给下一轮指定一个更具体的讨论点。`;
  }

  private moderatorSelfTrigger(roundNo: number): string {
    return `你是主持人,房间里暂无其他辩手,请就主题做第 ${roundNo} 轮自问自答式推进。`;
  }

  private finalTrigger(): string {
    return '讨论已到最后一轮,这是收场总结(终局发言,没有下一位)。请总结:各方核心观点、分歧点、可能的共识或结论。不要再写【接棒】行。';
  }

  /** 轮询挑下一位(排除 exclude;公平游标) */
  private pickAndEnqueue(exclude: string | null): void {
    const candidates = this.deps.room.members.filter((m) => m.id !== exclude);
    if (candidates.length === 0) return;
    const pick = candidates[this.fairCursor % candidates.length]!;
    this.fairCursor = (this.fairCursor + 1) % candidates.length;
    this.enqueue({
      memberId: pick.id,
      trigger: exclude
        ? '刚才有人发言了,轮到你接着说。可以回应、反驳或补充。'
        : '群里刚有新消息,你有话想说就说。',
      baton: true,
    });
  }

  // ---------- 单次发言执行(invoke)+ 尾部接棒决策 ----------

  private async runOne(member: MemberConfig, entry: SpeechEntry): Promise<void> {
    const genAtStart = entry.generation;
    await this.deps.runScout(); // 绑定项目的房间:首棒前侦察(内部幂等+熔断)

    const batonActive = entry.baton === true && this.state === 'baton';
    const prompt = await buildPrompt(this.deps.room, member, this.historySnapshot(), {
      trigger: entry.trigger,
      instruction: entry.instruction,
      batonMode: batonActive,
    });

    const outcome = await this.invokeWithRetry(member, prompt, entry.trigger);

    switch (outcome.status) {
      case 'cancelled':
        // stop/点名/轮流打断:不落库、不接棒,状态已被调用方置好
        this.statuses[member.id] = 'idle';
        this.onStatuses();
        return;
      case 'error': {
        this.statuses[member.id] = 'error';
        this.onStatuses();
        await this.sysMessage(`${member.name} 发言失败: ${outcome.error ?? '未知错误'}`);
        // 一律 idle:绝不从错误文本解析接棒,不自动重试
        this.setState('idle');
        return;
      }
      case 'ok':
        break;
    }

    this.statuses[member.id] = 'idle';
    this.lastSpeakAt[member.id] = Date.now();

    // 落库前:非接棒状态下的发言剥掉尾行接棒标记(防 session 记忆惯性复写)
    let finalText = outcome.result || '(无输出)';
    if (!batonActive) {
      finalText = finalText.replace(/【接棒】[^\n]*/g, '').trimEnd();
    }
    await this.deps.pushMessage({
      id: randomUUID(),
      roomId: this.deps.room.id,
      from: member.id,
      fromName: member.name,
      text: finalText,
      ts: Date.now(),
      detail: {
        trace: this.traceBuf,
        thinking: this.thinkingBuf || undefined,
        usage: this.lastUsage,
        durationMs: outcome.durationMs, // harness 真实计时(修 v1 0.0s bug)
        adapter: member.adapter,
        trigger: entry.trigger,
      },
    });
    await this.deps.persistRoom(); // 写穿 rooms.json(含最新 sessionIds)

    // 终局条目:轮流跑完回 idle
    if (entry.afterRounds === 'finalSummary') {
      await this.sysMessage('轮流发言结束。可继续 @成员 追问或发消息自由讨论。');
      this.setState('idle');
      return;
    }

    // 接棒决策:只在"接棒条目 + 状态仍是 baton + 世代未变"时发生
    if (batonActive && this.state === 'baton' && genAtStart === this.generation) {
      const baton = parseBaton(outcome.result, this.deps.room.members, member.id);
      if (baton.endDiscussion) {
        await this.sysMessage(`🏁 ${member.name} 宣布讨论结束。`);
        this.setState('idle');
        return;
      }
      const next = baton.nextMemberId
        ? this.deps.room.members.find((m) => m.id === baton.nextMemberId)
        : undefined;
      if (next) {
        if (this.budget <= 0) {
          await this.sysMessage('自由讨论已达接棒上限,发条新消息可继续。');
          this.setState('idle');
          return;
        }
        this.budget--;
        await this.sysMessage(`🎯 ${member.name} 把接棒交给 ${next.name}`);
        this.enqueue({
          memberId: next.id,
          trigger: `${member.name} 指定你接棒。请针对 TA 刚才的发言回应、反驳或补充。`,
          baton: true,
        });
        return;
      }
      // 没写接棒行/无效 → 停止,控制权回用户
      await this.sysMessage(`${member.name} 没有指定下一位,控制权回到你手中。发消息可继续讨论。`);
      this.setState('idle');
      return;
    }
  }

  /** invoke + resume 失败自愈(清 sessionId 重试一次)。
   *  cancelled(用户 stop/点名打断)绝不是失败——不重试,否则"停止"会立刻复活一个新进程
   *  (实测根因:用户须按两次停止)。 */
  private async invokeWithRetry(
    member: MemberConfig,
    prompt: string,
    trigger: string | undefined,
  ): Promise<SpeakOutcome> {
    const first = await this.invoke(member, prompt, trigger);
    if (first.status !== 'error') return first; // ok 原样;cancelled 直接透传,禁止重试
    const hadResume = member.sessionIds?.[member.adapter];
    if (hadResume) {
      // stale session 是最可能的失败因——清掉重试一次
      delete member.sessionIds![member.adapter];
      await this.deps.persistRoom();
      return this.invoke(member, prompt, trigger);
    }
    return first;
  }

  private thinkingBuf = '';
  private traceBuf: import('./types').TraceEntry[] = [];
  private lastUsage: ChatMessage['detail'] extends undefined ? never : NonNullable<ChatMessage['detail']>['usage'] = undefined;

  private async invoke(member: MemberConfig, prompt: string, trigger?: string): Promise<SpeakOutcome> {
    const acfg = this.deps.adapterConfigs[member.adapter];
    if (!acfg) {
      return { status: 'error', result: '', durationMs: 0, error: `适配器未配置: ${member.adapter}` };
    }
    const adapter = this.deps.resolveAdapter(member.adapter);

    this.statuses[member.id] = 'thinking';
    this.thinkingBuf = '';
    this.traceBuf = [];
    this.currentSpeaker = member.id;
    this.onStatuses();

    const trace = this.traceBuf;
    const req: import('../adapters/base').SpeakRequest = {
      member: member.id,
      prompt,
      command: acfg.command,
      args: [...acfg.args, ...(member.extraArgs ?? [])],
      cwd: this.deps.room.projectPath || undefined,
      resumeSessionId: member.sessionIds?.[member.adapter],
      permission: this.deps.room.toolPermission,
    };

    let usage: NonNullable<ChatMessage['detail']>['usage'] = undefined;
    const handle = adapter.speak(req, (ev: AgentEvent) => {
      // session id 发现:记录到成员(下次 resume)
      if (ev.sessionId) {
        member.sessionIds = { ...member.sessionIds, [member.adapter]: ev.sessionId };
      }
      if (ev.phase === 'thinking') {
        if (ev.thinkingDelta) {
          this.thinkingBuf += ev.thinkingDelta;
          trace.push({ kind: 'thinking', ts: Date.now(), content: ev.thinkingDelta });
        }
        if (ev.toolUse) trace.push({ kind: 'tool_use', ts: Date.now(), label: ev.toolUse.name, content: ev.toolUse.input });
        if (ev.toolResult) trace.push({ kind: 'tool_result', ts: Date.now(), label: ev.toolResult.name, content: ev.toolResult.output });
      } else if (ev.phase === 'streaming' && ev.textDelta) {
        trace.push({ kind: 'text', ts: Date.now(), content: ev.textDelta });
        if (this.statuses[member.id] === 'thinking') {
          this.statuses[member.id] = 'streaming';
          this.onStatuses();
        }
      } else if (ev.phase === 'done') {
        usage = ev.usage;
      }
      this.deps.pushAgentEvent?.(ev);
    });

    this.cancelCurrent = handle.cancel;
    const outcome = await handle.done;
    this.cancelCurrent = null;
    this.currentSpeaker = undefined;
    this.lastUsage = usage;
    return outcome;
  }

  // ---------- @指令解析 ----------

  private parseUserCommand(text: string):
    | { kind: 'mention'; member?: MemberConfig }
    | { kind: 'all'; rounds: number }
    | { kind: 'none' } {
    const allMatch = text.match(/@all\s*(\d*)/);
    if (allMatch) {
      return { kind: 'all', rounds: allMatch[1] ? Math.max(1, parseInt(allMatch[1])) : 1 };
    }
    // @成员名:提取所有 @ token,从最长开始尝试(用户最具体的意图优先)
    const atNames = [...text.matchAll(/@([^\s@,，。]+)/g)].map((mm) => mm[1]!);
    for (const raw of [...atNames].sort((a, b) => b.length - a.length)) {
      const hit = matchMemberByName(raw, this.deps.room.members);
      if (hit) return { kind: 'mention', member: hit };
    }
    return { kind: 'none' };
  }

  // ---------- 杂项 ----------

  private historySnapshot(): ChatMessage[] {
    return this.deps.getHistory();
  }

  private async sysMessage(text: string): Promise<void> {
    await this.deps.sysMessage(text);
  }

  private sysNotice(text: string): void {
    void this.sysMessage(text);
  }

  /** 预算变更(设置面板) */
  setBudget(n: number): void {
    this.budget = Math.max(0, n);
  }
}

export const MEMBER_PALETTE = PALETTE;
