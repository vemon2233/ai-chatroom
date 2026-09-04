// 编排器(v2 核心):显式状态机 + 单长驻异步循环串行队列 + 世代计数器。
//
// 状态:'idle'(控制权在用户)| 'baton'(接棒链执行中)| 'roundrobin'(@allN 执行中)
//
// 起手权模型(v2.1):谁起头由"上一个说话的人"决定,编排器从不自选——
//  - 待命接棒者(pendingNextId):点名回应/链末发言者在尾行 <接棒>@名字 指定;
//    链上传递直接开跑,点名回应则暂停待命(用户纯文本消息后 TA 起头)
//  - 用户 <接棒>@名字 消息 = 直接指定起手进链
//  - 无待命者的冷启动 → 随机起头(仅此一处编排器自行选人)
//
// v1 教训(本文件的设计全部由此推导,勿改):
//  - v1 用 6 个互锁标志位隐式表达状态 → pendingBaton 死锁、双触发、状态残留三类事故
//  - v1 队列是链式 .then(run,run):两个快速入队可在微任务级联中并发穿透 → 双进程
//  - v1 stop 后 status!=='error' 判断放行 → 半截垃圾消息落库
//  - v1 resume 失败无自愈 → 本房间后续发言永久失败
//  - v2.0 曾写死 members[0] 冷启动起头 → 实测"每轮讨论永远第一个 agent 开场"
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
  /** 接棒条目:发言结束后解析尾行决定下一位。chain=链上(结果直接开跑)/ callout=回应用户点名(结果待命暂停) */
  batonMode?: 'chain' | 'callout';
  /** @allN 条目跑完后的终局动作 */
  afterRounds?: 'finalSummary';
}

export class Orchestrator {
  state: OrchestrationState = 'idle';
  statuses: Record<string, MemberStatus> = {};
  currentSpeaker: string | undefined;

  /** 待命接棒者:点名回应者指定的下一位;用户下一条纯文本消息后 TA 起头(不持久化,重启即空) */
  private pendingNextId: string | undefined;
  private queue: SpeechEntry[] = [];
  private generation = 0;
  private budget: number;
  private loopRunning = false;
  private cancelCurrent: (() => void) | null = null;
  private currentRunPromise: Promise<void> | null = null;

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
    if (this.pendingNextId === memberId) this.pendingNextId = undefined;
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
        this.currentRunPromise = this.runOne(member, entry);
        try {
          await this.currentRunPromise;
        } finally {
          this.currentRunPromise = null;
        }
      }
    } finally {
      this.loopRunning = false;
    }
  }

  // ---------- 用户入口(全部由 ChatRoom 转发) ----------

  /** 用户消息(已入库):解析 @指令并驱动状态机。 */
  async onUserMessage(text: string): Promise<void> {
    const cmd = this.parseUserCommand(text);

    switch (cmd.kind) {
      case 'start': {
        // <接棒>@xx:直接指定起手进接棒链
        this.bumpGeneration();
        this.cancelCurrent?.();
        this.pendingNextId = undefined;
        this.setState('baton');
        this.enqueue({
          memberId: cmd.member.id,
          trigger: `${cmd.fromName} 指定你起头,请就主题开个头或回应该消息。`,
          batonMode: 'chain',
        });
        return;
      }
      case 'mention': {
        // 点名 = 回应 + 指定待命接棒者:bump 世代取消一切未开始条目(含旧 @name),
        // 被点名者回应并在尾行 <接棒>@xx 指定下一位 → 暂停,用户发话后 xx 起头
        this.bumpGeneration();
        this.cancelCurrent?.();
        this.pendingNextId = undefined;
        this.state = 'idle';
        this.onStatuses();
        if (cmd.member) {
          this.sysNotice(`已取消之前的指令,@${cmd.member.name} 将回应你并指定下一位`);
          this.enqueue({
            memberId: cmd.member.id,
            trigger: `用户在聊天中 @了你,请回应用户。回应完在结尾用 <接棒>@名字 指定下一位(讨论将暂停等待用户)。`,
            batonMode: 'callout',
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
        this.pendingNextId = undefined;
        this.startRoundRobin(cmd.rounds);
        return;
      }
      case 'none':
      default: {
        // 纯文本:待命接棒者起头;无待命者 → 随机起头。预算重置。
        this.budget = this.deps.room.chainBudget;
        this.startFreeDiscussion();
        return;
      }
    }
  }

  /** 纯文本消息的起手决策(「开始」按钮共用入口)。
   *  待命接棒者(点名回应者指定)起头;无待命者冷启动 → 随机(唯一自选点);
   *  已在 baton 且有人在说/队列非空 → 不打扰(链自行驱动)。
   *  ⚠ 触发冷场补救:baton 中无人说且队列空(防御性,正常路径到不了)。 */
  startFreeDiscussion(): void {
    const members = this.deps.room.members;
    if (this.state === 'idle' && members.length > 0 && this.currentSpeaker == null) {
      this.setState('baton');
      const starter = this.pickStarter(members);
      const origin = this.pendingNextId
        ? `${starter.name} 是之前被指定的接棒对象`
        : '冷启动随机选中';
      this.pendingNextId = undefined;
      this.sysNotice(`${origin},${starter.name} 起头`);
      this.enqueue({
        memberId: starter.id,
        trigger: '讨论继续,请你先就主题开个头。',
        batonMode: 'chain',
      });
    } else if (this.state === 'baton' && this.currentSpeaker == null && this.queue.length === 0) {
      // 冷场补救:没人在说、队列空(上次没写接棒行已回 idle,不该到这里;防御性保留)
      const starter = this.pickStarter(members);
      this.pendingNextId = undefined;
      this.enqueue({
        memberId: starter.id,
        trigger: '刚才有人发言了,轮到你接着说。可以回应、反驳或补充。',
        batonMode: 'chain',
      });
    }
  }

  /** 起手选择:待命接棒者优先(成员被移除则作废);否则随机(冷启动,唯一自选点)。 */
  private pickStarter(members: MemberConfig[]): MemberConfig {
    if (this.pendingNextId) {
      const hit = members.find((m) => m.id === this.pendingNextId);
      if (hit) return hit;
    }
    return members[Math.floor(Math.random() * members.length)]!;
  }

  /** 停止按钮:bump 世代 + 杀当前进程 → idle(待命接棒者保留——停止不撤销既定意向) */
  async stop(): Promise<void> {
    this.bumpGeneration();
    this.cancelCurrent?.();
    if (this.currentRunPromise) {
      try {
        await this.currentRunPromise;
      } catch {
        // 忽略已取消抛出的异常
      }
    }
    this.setState('idle');
  }

  /** 单次发言重roll:清除当前队列与正在进行的发言,直接让该成员重新说一次,且发完强制回到 idle 态(不传棒) */
  rerollAgent(memberId: string): void {
    const member = this.deps.room.members.find((m) => m.id === memberId);
    if (!member) {
      this.sysNotice(`找不到重roll成员: ${memberId}`);
      this.setState('idle');
      return;
    }
    this.bumpGeneration();
    this.cancelCurrent?.();
    this.pendingNextId = undefined;
    this.setState('idle');
    this.onStatuses();
    this.enqueue({
      memberId,
      trigger: '请重新生成你的发言。针对上述讨论发表你的观点。',
      batonMode: undefined, // 不传棒,发完直接 idle
    });
  }

  /** 用户给成员直接下指令(同 @点名语义:回应 + 指定待命接棒者) */
  directInstruction(memberId: string, userText: string): void {
    this.bumpGeneration();
    this.cancelCurrent?.();
    this.pendingNextId = undefined;
    this.state = 'idle';
    this.onStatuses();
    this.enqueue({
      memberId,
      trigger: `用户(房间主人)直接对你说:${userText}\n回应完在结尾用 <接棒>@名字 指定下一位(讨论将暂停等待用户)。`,
      batonMode: 'callout',
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
    return '讨论已到最后一轮,这是收场总结(终局发言,没有下一位)。请总结:各方核心观点、分歧点、可能的共识或结论。不要再写接棒行。';
  }

  // ---------- 单次发言执行(invoke)+ 尾部接棒决策 ----------

  private async runOne(member: MemberConfig, entry: SpeechEntry): Promise<void> {
    const genAtStart = entry.generation;
    await this.deps.runScout(); // 绑定项目的房间:首棒前侦察(内部幂等+熔断)

    // 接棒语义由条目自带(callout 在 idle 态执行——点名回应不需要全局 baton 状态背书;
    // state 门闩只用于尾部 chain 传递决策,防 roundrobin 残留条目误传棒)
    const batonActive = entry.batonMode != null;
    const prompt = await buildPrompt(this.deps.room, member, this.historySnapshot(), {
      trigger: entry.trigger,
      instruction: entry.instruction,
      batonMode: entry.batonMode,
    });

    const { outcome, trace, thinking, usage } = await this.invokeWithRetry(member, prompt);

    switch (outcome.status) {
      case 'cancelled': {
        // stop/点名/轮流打断:正文不落库,但"发言被终止"本身是聊天历史的一部分——
        // 记一条已停止占位消息(刷新后仍可见,替代凭空消失)
        this.statuses[member.id] = 'idle';
        const streamed = trace
          .filter((t) => t.kind === 'text')
          .map((t) => t.content)
          .join('');
        await this.deps.pushMessage({
          id: randomUUID(),
          roomId: this.deps.room.id,
          from: member.id,
          fromName: member.name,
          text: streamed.trim() || '(已停止思考)',
          ts: Date.now(),
          detail: {
            trace,
            thinking: thinking || undefined,
            durationMs: outcome.durationMs,
            adapter: member.adapter,
            trigger: entry.trigger,
          },
        });
        this.onStatuses();
        return;
      }
      case 'error': {
        this.statuses[member.id] = 'error';
        await this.sysMessage(`${member.name} 发言失败: ${outcome.error ?? '未知错误'}`);
        // error → 一律 idle 且终止本轮编排:绝不从错误文本解析接棒,不自动重试;
        // bump 世代作废队列残留(否则轮流剩余条目会在 state=idle 的伪装下继续跑)
        this.bumpGeneration();
        // error 不粘滞:全员复位 idle(红点只在出错瞬间可见,下一次交互不再干扰)
        for (const id of Object.keys(this.statuses)) {
          if (this.statuses[id] === 'error') this.statuses[id] = 'idle';
        }
        this.setState('idle');
        return;
      }
      case 'ok':
        break;
    }

    this.statuses[member.id] = 'idle';

    // 落库前:非链上发言剥掉尾行接棒标记(防 session 记忆惯性复写;新旧语法都剥)
    let finalText = outcome.result || '(无输出)';
    if (!batonActive) {
      finalText = finalText.replace(/(?:<接棒>|【接棒】)[^\n]*/g, '').trimEnd();
    }
    await this.deps.pushMessage({
      id: randomUUID(),
      roomId: this.deps.room.id,
      from: member.id,
      fromName: member.name,
      text: finalText,
      ts: Date.now(),
      detail: {
        trace,
        thinking: thinking || undefined,
        usage,
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

    // 接棒决策:只在"接棒条目 + 世代未变"时发生;
    // callout(点名回应)在 idle 态合法执行 → 尾部门闩不看 state,只看条目语义与世代
    if (batonActive && genAtStart === this.generation) {
      const baton = parseBaton(outcome.result, this.deps.room.members, member.id);
      if (baton.endDiscussion) {
        await this.sysMessage(`🏁 ${member.name} 宣布讨论结束。`);
        this.setState('idle');
        return;
      }
      const next = baton.nextMemberId
        ? this.deps.room.members.find((m) => m.id === baton.nextMemberId)
        : undefined;
      if (!next) {
        // 没写接棒行/无效:不指定任何人,控制权回用户
        await this.sysMessage(`${member.name} 没有指定下一位,控制权回到你手中。发消息将从随机成员继续。`);
        this.setState('idle');
        return;
      }
      if (entry.batonMode === 'callout') {
        // 点名回应:指定者进入待命,讨论暂停——用户下一条纯文本消息后 TA 起头
        this.pendingNextId = next.id;
        await this.sysMessage(`⏸ ${member.name} 指定 ${next.name} 接棒。你发消息后 TA 开始发言。`);
        this.setState('idle');
        return;
      }
      // 链上传递:立即开跑(预算闸门)
      if (this.budget <= 0) {
        this.pendingNextId = next.id;
        await this.sysMessage('自由讨论已达接棒上限,发条新消息可继续。');
        this.setState('idle');
        return;
      }
      this.budget--;
      await this.sysMessage(`🎯 ${member.name} 把接棒交给 ${next.name}`);
      this.enqueue({
        memberId: next.id,
        trigger: `${member.name} 指定你接棒。请针对 TA 刚才的发言回应、反驳或补充。`,
        batonMode: 'chain',
      });
      return;
    }
  }

  /** invoke + resume 失败自愈(清 sessionId 重试一次)。
   *  cancelled(用户 stop/点名打断)绝不是失败——不重试,否则"停止"会立刻复活一个新进程
   *  (实测根因:用户须按两次停止)。 */
  private async invokeWithRetry(
    member: MemberConfig,
    prompt: string,
  ): Promise<Awaited<ReturnType<Orchestrator['invoke']>>> {
    const first = await this.invoke(member, prompt);
    if (first.outcome.status !== 'error') return first; // ok 原样;cancelled 直接透传,禁止重试
    const hadResume = member.sessionIds?.[member.adapter];
    if (hadResume) {
      // stale session 是最可能的失败因——清掉重试一次
      delete member.sessionIds![member.adapter];
      await this.deps.persistRoom();
      return this.invoke(member, prompt);
    }
    return first;
  }

  /** invoke 产物:outcome + 本次发言的过程缓冲(局部变量,不挂实例——
   *  队列虽串行,但把过程状态显式装进返回值可让"无并发窗口"成为类型可见的事实) */
  private async invoke(member: MemberConfig, prompt: string): Promise<{
    outcome: SpeakOutcome;
    trace: import('./types').TraceEntry[];
    thinking: string;
    usage: NonNullable<ChatMessage['detail']>['usage'];
  }> {
    const acfg = this.deps.adapterConfigs[member.adapter];
    if (!acfg) {
      return {
        outcome: { status: 'error', result: '', durationMs: 0, error: `适配器未配置: ${member.adapter}` },
        trace: [], thinking: '', usage: undefined,
      };
    }
    const adapter = this.deps.resolveAdapter(member.adapter);

    this.statuses[member.id] = 'thinking';
    this.currentSpeaker = member.id;
    this.onStatuses();

    // 本次发言的过程缓冲(局部;invoke 的生命周期内聚)
    const trace: import('./types').TraceEntry[] = [];
    let thinking = '';
    let usage: NonNullable<ChatMessage['detail']>['usage'] = undefined;

    const req: import('../adapters/base').SpeakRequest = {
      member: member.id,
      prompt,
      command: acfg.command,
      args: [...acfg.args, ...(member.extraArgs ?? [])],
      cwd: this.deps.room.projectPath || undefined,
      resumeSessionId: member.sessionIds?.[member.adapter],
      permission: this.deps.room.toolPermission,
    };

    const handle = adapter.speak(req, (ev: AgentEvent) => {
      // session id 发现:记录到成员(下次 resume)
      if (ev.sessionId) {
        member.sessionIds = { ...member.sessionIds, [member.adapter]: ev.sessionId };
      }
      if (ev.phase === 'thinking') {
        if (ev.thinkingDelta) {
          thinking += ev.thinkingDelta;
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
    return { outcome, trace, thinking, usage };
  }

  // ---------- @指令解析 ----------

  private parseUserCommand(text: string):
    | { kind: 'start'; member: MemberConfig; fromName: string }
    | { kind: 'mention'; member?: MemberConfig }
    | { kind: 'all'; rounds: number }
    | { kind: 'none' } {
    // <接棒>@xx / 【接棒】@xx(与 agent 同一语法):直接指定起手进链
    const startMatch = text.match(/(?:<接棒>|【接棒】)\s*@([^\s@,，。]+)/);
    if (startMatch) {
      const hit = matchMemberByName(startMatch[1]!, this.deps.room.members);
      if (hit) return { kind: 'start', member: hit, fromName: '用户' };
      // 名字没对上 → 按 mention 处理会误触发"点名回应"语义;这里提示并忽略
      return { kind: 'none' };
    }
    const allMatch = text.match(/@all\s*(\d*)/);
    if (allMatch) {
      return { kind: 'all', rounds: allMatch[1] ? Math.max(1, parseInt(allMatch[1])) : 1 };
    }
    // @成员名:提取所有 @ token,从最长开始尝试(用户最具体的意图优先)
    // ⚠ token 语法与前端 web/src/mentions.ts 是同一契约的双语言实现——改这里必须同步改那边
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
