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
import { buildPrompt, buildDeltaPrompt, extractDeltaMessages } from './prompt';
import { matchMemberByName } from './naming';
import { parseBaton, stripBatonLine } from './modes/baton/baton';
import { stripAudienceLine } from './modes/subscribe/audience';
import { publishSpeechResult } from './modes/subscribe/publish';
import { SubscribeEngine } from './modes/subscribe/engine';
import { BATON_LINE, AT_NAME, AT_NAME_GLOBAL, USER_NAME_ALIASES } from '../protocolKeywords';
import type { AgentAdapter, AgentEvent, SpeakOutcome } from '../adapters/base';
import type {
  AgentTraceLog,
  ChatMessage,
  MemberConfig,
  MemberStatus,
  RoomConfig,
  OrchestrationState,
  DiscussionSummary,
  SummaryConfig,
} from './types';
import { executeCompactSession } from './summaryOps';
import { t } from './i18n/messages';
import { DEFAULT_LANG, type Lang, type LangGetter } from './i18n/lang';
import { batonTagFor } from '../protocolKeywords';

/** 适配器注册表抽象(测试注入 fake 的接缝) */
export type AdapterResolver = (adapterKey: string) => AgentAdapter;

export interface OrchestratorDeps {
  room: RoomConfig;                    // 房间配置(可变引用:成员/设置运行期改)
  adapterConfigs: Record<string, { kind?: string; command: string; args: string[] }>;
  resolveAdapter: AdapterResolver;
  /** 消息出口:落库+广播(由 ChatRoom 提供) */
  pushMessage: (msg: ChatMessage) => Promise<void>;
  /** 系统消息便捷出口 */
  sysMessage: (text: string) => Promise<void>;
  /** 成员状态快照变更(广播 roomState) */
  onStatuses: () => void;
  /** rooms.json 写穿(成员消息完成后;带最新 sessionIds) */
  persistRoom: () => Promise<void>;
  /** Scout/Admin 预检:返回侦察消息(若该跑) */
  runScout: () => Promise<ChatMessage | null>;
  /** 聊天历史快照(prompt 组装用) */
  getHistory: () => ChatMessage[];
  /** 适配器事件转发(WS 实时流) */
  pushAgentEvent: (ev: AgentEvent) => void;
  /** 获取当前讨论上下文摘要对象(若有) */
  getSummary?: () => DiscussionSummary | null;
  /** 压缩层配置(autoThreshold, privateThreshold, compactThreshold) */
  summaryCfg?: SummaryConfig;
  /** Trace 落库接缝(未注入时跳过——测试场景) */
  saveTrace?: (scope: 'room' | 'direct', id: string, trace: AgentTraceLog) => Promise<void>;
  /** 语言注入(未注入 → zh,与改造前逐字节一致) */
  getLang?: LangGetter;
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
  /** @allN 轮次全部结束的收尾标记(打在最后一名成员的正常发言条目上) */
  afterRounds?: 'roundsEnd';
  /** 订阅模式:点名/起头/轮流等强制回应条目——prompt 禁跳过 + silent 兜底通知(仅订阅模式条目标记;跳过出口只属于心跳自主决策) */
  mustRespond?: boolean;
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
  /** 活动中可取消函数集合(支持波次并行全部强杀, 杜绝孤儿进程) */
  private activeCancels = new Set<() => void>();
  private currentRunPromise: Promise<void> | null = null;
  /** 订阅模式领域引擎实例 */
  private subscribeEngine: SubscribeEngine;
  /** 成员已消费消息游标 (运行时内存维护, 不污染配置实体): memberId -> lastSeenMessageId */
  private memberCursors = new Map<string, string>();
  /** Stateful 成员可见消息计数 */
  private memberMsgCounts = new Map<string, number>();
  /** 正在执行 compact 的成员(值为进行中的 compact promise),防止并发踩踏同一个 session */
  private compactingPromises = new Map<string, Promise<boolean>>();
  /** compact 失败次数，连续失败熔断 */
  private compactFailures = new Map<string, number>();

  /** 当前语言(发射时刻取值;未注入恒 zh——现状不变量) */
  private get lang(): Lang {
    return this.deps.getLang?.() ?? DEFAULT_LANG;
  }

  constructor(private deps: OrchestratorDeps) {
    this.budget = deps.room.chainBudget;
    for (const m of deps.room.members) this.statuses[m.id] = 'idle';

    this.subscribeEngine = new SubscribeEngine({
      getRoom: () => this.deps.room,
      getHistory: () => this.historySnapshot(),
      getSummaryContext: () => ({ summary: this.deps.getSummary?.() ?? null }),
      saveTrace: this.deps.saveTrace,
      speak: async (member, prompt) => {
        try {
          const contextMode = this.deps.room.contextMode ?? 'stateless';
          const existingSessionId = member.sessionIds?.[member.adapter];
          const resumeSessionId = (contextMode === 'stateful' && existingSessionId) ? existingSessionId : undefined;
          const { outcome, trace, thinking, usage, req } = await this.invokeWithRetry(member, prompt, resumeSessionId);
          if (outcome.status === 'ok') {
            this.maybeCompact(member);
          }
          // 心跳 trace 素材随结果返回(由 publishMessage 落首气泡 trace,不再经构造器闭包传递)
          return {
            result: outcome.result,
            status: outcome.status,
            error: outcome.error,
            trace,
            thinking,
            usage,
            durationMs: outcome.durationMs,
            invocation: {
              prompt,
              command: req.command,
              args: req.args,
              cwd: req.cwd,
              resumeSessionId: req.resumeSessionId,
            },
          };
        } finally {
          this.statuses[member.id] = 'idle';
          if (this.currentSpeaker === member.id) {
            this.currentSpeaker = undefined;
          }
          this.onStatuses();
        }
      },

      publishMessage: async (msg) => {
        const member = this.deps.room.members.find((m) => m.id === msg.from);
        await this.deps.pushMessage(msg);
        if (member) {
          this.memberCursors.set(member.id, msg.id);
        }
        await this.deps.persistRoom();
      },
      sysMessage: (text) => this.sysMessage(text),

      consumeBudget: () => {
        if (this.budget <= 0) return false;
        this.budget--;
        return true;
      },
      isBusy: () => this.loopRunning || this.currentRunPromise !== null,
      onMentioned: async (target, triggerReason) => {
        if (this.budget <= 0) {
          console.log('[subscribe] 自动发言上限已达，不再入队 @ 唤醒发言');
          return;
        }
        this.enqueue({
          memberId: target.id,
          trigger: triggerReason,
          mustRespond: this.deps.room.mode === 'subscribe', // 同事点名:订阅模式下强制回应
        });
      },
      onIdle: () => {
        this.setState('idle');
      },
    });
  }

  /** 新成员加入(房间门面调用) */
  memberAdded(member: MemberConfig): void {
    this.statuses[member.id] = 'idle';
    this.onStatuses();
  }

  /** 历史重置(clearMessages)时彻底清空私聊协议(线程与硬闸计数归零) */
  clearPrivateProtocol(): void {
    this.subscribeEngine.clearProtocol();
  }

  /** 重启复活:从持久化历史重建私聊协议(线程簿记/硬闸计数/防撞号上限) */
  rebuildPrivateProtocolFromHistory(): void {
    this.subscribeEngine.rebuildFromHistory(this.deps.getHistory());
  }

  /** 成员移除:状态清除 + 队列中该成员的条目一并移除 + 关闭 TA 的私聊线程(队列归编排器所有,防御内聚于此) */
  memberRemoved(memberId: string): void {
    delete this.statuses[memberId];
    if (this.pendingNextId === memberId) this.pendingNextId = undefined;
    this.queue = this.queue.filter((e) => e.memberId !== memberId);
    this.subscribeEngine.closeThreadsForMember(memberId); // 幽灵通道防御:对端不在了,线程必关
    if (this.currentSpeaker === memberId) this.cancelAll();
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

  private cancelAll(): void {
    for (const cancel of this.activeCancels) {
      try {
        cancel();
      } catch {}
    }
    this.activeCancels.clear();
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
        this.subscribeEngine.setExternalSpeaking(true, member.id);
        this.currentRunPromise = this.runOne(member, entry);
        try {
          await this.currentRunPromise;
        } finally {
          this.currentRunPromise = null;
          this.subscribeEngine.setExternalSpeaking(false);
          this.subscribeEngine.drainSpeakerQueue();
        }
      }
    } finally {
      this.loopRunning = false;
      this.subscribeEngine.setExternalSpeaking(false);
      this.subscribeEngine.drainSpeakerQueue();
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
        this.cancelAll();
        this.pendingNextId = undefined;
        this.budget = this.deps.room.chainBudget;
        this.setState('baton');
        this.enqueue({
          memberId: cmd.member.id,
          trigger: t(this.lang, 'orch.trigger.designatedStart', { fromName: cmd.fromName }),
          batonMode: 'chain',
        });
        return;
      }
      case 'mention': {
        // 点名 = 回应 + 指定待命接棒者:bump 世代取消一切未开始条目(含旧 @name)
        this.bumpGeneration();
        this.cancelAll();
        this.pendingNextId = undefined;
        this.budget = this.deps.room.chainBudget;

        if (this.deps.room.mode === 'subscribe') {
          // 订阅模式: 多 @ 角色依次排队唤醒，提示词中不使用接棒指令
          this.setState('subscribe');
          this.subscribeEngine.start(this.deps.room.members);
          if (cmd.members && cmd.members.length > 0) {
            const names = cmd.members.map((m) => `@${m.name}`).join(' ');
            this.sysNotice(t(this.lang, 'orch.wokeQueued', { names }));
            for (const m of cmd.members) {
              // 延后被点名成员心跳，避免响应期间或紧随其后发生短延时重复心跳
              this.subscribeEngine.resetMemberHeartbeat(m.id);
              this.enqueue({
                memberId: m.id,
                trigger: t(this.lang, 'orch.trigger.atMentionedSubscribe'),
                batonMode: undefined,
                mustRespond: true, // 用户点名:强制回应,禁跳过
              });
            }
          } else {
            this.sysNotice(t(this.lang, 'orch.mentionNotFound'));
          }
        } else {
          // 接棒模式: 保留原有点名接棒
          this.state = 'idle';
          this.onStatuses();
          if (cmd.member) {
            this.sysNotice(t(this.lang, 'orch.mentionReplaced', { name: cmd.member.name }));
            this.enqueue({
              memberId: cmd.member.id,
              trigger: t(this.lang, 'orch.trigger.atMentionedBaton', { batonTag: batonTagFor(this.lang) }),
              batonMode: 'callout',
            });
          } else {
            this.sysNotice(t(this.lang, 'orch.mentionNotFound'));
          }
        }
        return;
      }
      case 'all': {
        // 轮流 N 轮:bump 世代,预入队全部条目(成员×N轮)
        this.bumpGeneration();
        this.cancelAll();
        this.pendingNextId = undefined;
        this.budget = this.deps.room.chainBudget;
        this.startRoundRobin(cmd.rounds);
        return;
      }
      case 'none':
      default: {
        // 纯文本: 根据当前房间模式分流驱动
        this.budget = this.deps.room.chainBudget;
        if (this.deps.room.mode === 'subscribe') {
          this.setState('subscribe');
          this.subscribeEngine.start(this.deps.room.members);
          // 用户未 @ 任何角色时，立即随机唤醒一名成员起头发言回应用户
          if (this.deps.room.members.length > 0) {
            const starter = this.pickStarter(this.deps.room.members);
            this.sysNotice(t(this.lang, 'orch.continueRandom', { name: starter.name }));
            // 延后起头成员心跳，杜绝初始 1~4s 短延时定时器在发言期间重叠触发
            this.subscribeEngine.resetMemberHeartbeat(starter.id);
            this.enqueue({
              memberId: starter.id,
              trigger: t(this.lang, 'orch.trigger.userNewViewpoint'),
              batonMode: undefined,
              mustRespond: true, // 被唤醒回应用户:强制回应,禁跳过
            });
          }
        } else {
          this.startFreeDiscussion();
        }
        return;
      }
    }
  }

  /**
   * 讨论启动入口(点击「开始」按钮时共用入口)
   */
  startDiscussion(): void {
    if (this.deps.room.mode === 'subscribe') {
      this.budget = this.deps.room.chainBudget;
      this.setState('subscribe');
      this.subscribeEngine.start(this.deps.room.members);
      if (this.deps.room.members.length > 0 && this.queue.length === 0 && !this.currentSpeaker) {
        const starter = this.pickStarter(this.deps.room.members);
        this.sysNotice(t(this.lang, 'orch.startRandom', { name: starter.name }));
        this.subscribeEngine.resetMemberHeartbeat(starter.id);
        this.enqueue({
          memberId: starter.id,
          trigger: t(this.lang, 'orch.trigger.discussionOpen'),
          batonMode: undefined,
          mustRespond: true, // 讨论起头:强制开题,禁跳过
        });
      }
    } else {
      this.startFreeDiscussion();
    }
  }

  /** 纯文本消息的起手决策(接棒模式)。
   *  待命接棒者(点名回应者指定)起头;无待命者冷启动 → 随机(唯一自选点);
   *  已在 baton 且有人在说/队列非空 → 不打扰(链自行驱动)。
   */
  startFreeDiscussion(): void {
    const members = this.deps.room.members;
    if (this.state === 'idle' && members.length > 0 && this.currentSpeaker == null) {
      this.setState('baton');
      const starter = this.pickStarter(members);
      const origin = this.pendingNextId
        ? t(this.lang, 'trace.pendingReason', { name: starter.name })
        : t(this.lang, 'trace.coldStartPicked');
      this.pendingNextId = undefined;
      this.sysNotice(t(this.lang, 'orch.starterOrigin', { origin, name: starter.name }));
      this.enqueue({
        memberId: starter.id,
        trigger: t(this.lang, 'orch.trigger.discussionContinue'),
        batonMode: 'chain',
      });
    } else if (this.state === 'baton' && this.currentSpeaker == null && this.queue.length === 0) {
      // 冷场补救:没人在说、队列空
      const starter = this.pickStarter(members);
      this.pendingNextId = undefined;
      this.enqueue({
        memberId: starter.id,
        trigger: t(this.lang, 'orch.trigger.deadAir'),
        batonMode: 'chain',
      });
    }
  }

  /** 起手选择:待命接棒者优先;否则随机。 */
  private pickStarter(members: MemberConfig[]): MemberConfig {
    if (this.pendingNextId) {
      const hit = members.find((m) => m.id === this.pendingNextId);
      if (hit) return hit;
    }
    return members[Math.floor(Math.random() * members.length)]!;
  }

  /** 停止按钮:bump 世代 + 强杀全部进行中进程 + 清理心跳 → idle */
  async stop(): Promise<void> {
    this.bumpGeneration();
    this.cancelAll();
    this.subscribeEngine.stop();
    if (this.currentRunPromise) {
      try {
        await this.currentRunPromise;
      } catch {
        // 忽略已取消抛出的异常
      }
    }
    // 全员状态强制收拢为 idle，杜绝前端残留思考中
    for (const m of this.deps.room.members) {
      this.statuses[m.id] = 'idle';
    }
    this.currentSpeaker = undefined;
    this.memberCursors.clear();
    this.setState('idle');
  }

  /** 单次发言重roll:清除当前队列与正在进行的发言,直接让该成员重新说一次,发完强制回到 idle 态 */
  rerollAgent(memberId: string): void {
    const member = this.deps.room.members.find((m) => m.id === memberId);
    if (!member) {
      this.sysNotice(t(this.lang, 'orch.rerollNotFound', { id: memberId }));
      this.setState('idle');
      return;
    }
    this.memberCursors.delete(memberId);
    this.bumpGeneration();
    this.cancelAll();
    this.pendingNextId = undefined;
    this.setState('idle');
    this.onStatuses();
    this.enqueue({
      memberId,
      trigger: t(this.lang, 'orch.trigger.reroll'),
      batonMode: undefined,
      mustRespond: this.deps.room.mode === 'subscribe' || undefined, // 订阅模式下重roll必须产出
    });
  }

  /** 用户给成员直接下指令 */
  directInstruction(memberId: string, userText: string): void {
    this.bumpGeneration();
    this.cancelAll();
    this.pendingNextId = undefined;
    this.state = 'idle';
    this.onStatuses();
    this.enqueue({
      memberId,
      trigger: t(this.lang, 'orch.trigger.userDirect', { text: userText, batonTag: batonTagFor(this.lang) }),
      batonMode: 'callout',
      mustRespond: this.deps.room.mode === 'subscribe' || undefined, // 订阅模式下直接指令必须回应
    });
  }

  // ---------- @allN 轮流(预入队全部条目) ----------

  private startRoundRobin(rounds: number): void {
    const members = this.deps.room.members;
    if (members.length === 0) return;

    this.setState('roundrobin');
    const mustRespond = this.deps.room.mode === 'subscribe'; // 订阅模式下轮流发言禁跳过
    for (let r = 1; r <= rounds; r++) {
      members.forEach((m, i) => {
        const isLastEntry = r === rounds && i === members.length - 1;
        this.enqueue({
          memberId: m.id,
          trigger: this.turnTrigger(r, i, members.length),
          mustRespond: mustRespond || undefined,
          afterRounds: isLastEntry ? 'roundsEnd' : undefined,
        });
      });
    }
    void this.sysMessage(t(this.lang, 'orch.roundsStart', { rounds }));

    // v2.1:轮次文案由词典组装(zh 逐字节现状)
  }

  private turnTrigger(roundNo: number, posInRound: number, total: number): string {
    const first = roundNo === 1 && posInRound === 0;
    if (posInRound === total - 1 && roundNo > 1) {
      return t(this.lang, 'orch.trigger.roundsLast', { round: roundNo });
    }
    return t(this.lang, 'orch.trigger.roundsMid', {
      round: roundNo,
      tail: first ? t(this.lang, 'orch.trigger.roundsFirst') : t(this.lang, 'orch.trigger.roundsRespond'),
    });
  }

  // ---------- 单次发言执行(invoke)+ 尾部决策 ----------

  private async runOne(member: MemberConfig, entry: SpeechEntry): Promise<void> {
    const genAtStart = entry.generation;
    await this.deps.runScout(); // 绑定项目的房间:首棒前侦察

    const batonActive = entry.batonMode != null;
    const contextMode = this.deps.room.contextMode ?? 'stateless';
    const existingSessionId = member.sessionIds?.[member.adapter];

    let prompt: string;
    let resumeSessionId: string | undefined = undefined;

    if (contextMode === 'stateful' && existingSessionId) {
      const history = this.historySnapshot();
      const lastSeenId = this.memberCursors.get(member.id);
      const { delta, isReanchored } = extractDeltaMessages(history, lastSeenId);

      resumeSessionId = existingSessionId;
      if (isReanchored) {
        // 游标失效(如历史被截断或重启恢复)，采用全量历史重新锚定上下文
        prompt = await buildPrompt(this.deps.room, member, history, {
          trigger: entry.trigger,
          instruction: entry.instruction,
          batonMode: entry.batonMode,
          summary: this.deps.getSummary?.(),
          mustRespond: entry.mustRespond,
        });
      } else {
        // 正常增量调用：只注入自上次发言以来的新增对话与精简行动指引
        prompt = buildDeltaPrompt(this.deps.room, member, delta, {
          trigger: entry.trigger,
          instruction: entry.instruction,
          batonMode: entry.batonMode,
          mustRespond: entry.mustRespond,
        });
      }
    } else {
      // stateless 模式或首次发言冷启动：全量 Prompt 注入
      prompt = await buildPrompt(this.deps.room, member, this.historySnapshot(), {
        trigger: entry.trigger,
        instruction: entry.instruction,
        batonMode: entry.batonMode,
        summary: this.deps.getSummary?.(),
        mustRespond: entry.mustRespond,
      });
      resumeSessionId = undefined;
    }

    const { outcome, trace, thinking, usage, req } = await this.invokeWithRetry(
      member,
      prompt,
      resumeSessionId,
    );

    let runOneTraceId: string | null = randomUUID();

    const recordTraceOnce = (finalFullResult: string) => {
      if (!runOneTraceId) return;
      const traceLog: AgentTraceLog = {
        messageId: runOneTraceId,
        roomId: this.deps.room.id,
        memberId: member.id,
        memberName: member.name,
        adapter: member.adapter,
        ts: Date.now(),
        durationMs: outcome.durationMs,
        status: outcome.status,
        error: outcome.error,
        trigger: entry.trigger,
        input: {
          prompt,
          command: req.command,
          args: req.args,
          cwd: req.cwd,
          resumeSessionId: req.resumeSessionId,
          contextMode: req.resumeSessionId ? 'stateful' : 'stateless',
        },
        output: {
          result: finalFullResult,
          thinking: thinking || undefined,
          trace: trace ?? [],
          usage,
        },
      };
      void this.deps.saveTrace?.('room', this.deps.room.id, traceLog);
    };

    switch (outcome.status) {
      case 'cancelled': {
        this.statuses[member.id] = 'idle';
        const streamed = trace
          .filter((t) => t.kind === 'text')
          .map((t) => t.content)
          .join('');
        const text = streamed.trim() || t(this.lang, 'sys.stoppedThinking');
        const msgId = runOneTraceId!;
        recordTraceOnce(text);
        runOneTraceId = null;
        await this.deps.pushMessage({
          id: msgId,
          roomId: this.deps.room.id,
          from: member.id,
          fromName: member.name,
          text,
          ts: Date.now(),
          detail: {
            trace,
            thinking: thinking || undefined,
            durationMs: outcome.durationMs,
            adapter: member.adapter,
            trigger: entry.trigger,
            hasTrace: true,
          },
        });
        this.onStatuses();
        return;
      }
      case 'error': {
        this.statuses[member.id] = 'error';
        await this.sysMessage(t(this.lang, 'orch.speakFailed', {
          name: member.name,
          error: outcome.error ?? t(this.lang, 'sys.unknownError'),
        }));
        this.bumpGeneration();
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

    // 格式清洗与私聊解析
    let finalText = outcome.result || t(this.lang, 'sys.noOutput');

    if (this.deps.room.mode === 'subscribe') {
      // 订阅模式: 发布管线唯一真源(silent 判定+通知/拆分/兜底/发布循环/traceId 令牌)
      const pubOutcome = await publishSpeechResult(
        member,
        outcome.result,
        {
          trace,
          thinking: thinking || undefined,
          usage,
          durationMs: outcome.durationMs,
          adapter: member.adapter,
          trigger: entry.trigger,
        },
        {
          roomId: this.deps.room.id,
          members: this.deps.room.members,
          publish: async (msg) => {
            await this.deps.pushMessage(msg);
            this.memberCursors.set(member.id, msg.id);
          },
          resolvePrivateMeta: (senderId, targetId, handshake) =>
            this.subscribeEngine.resolvePrivateMeta(senderId, targetId, handshake),
          sysMessage: (text) => this.sysMessage(text),
          traceMessageId: runOneTraceId ?? undefined,
          tSilent: (mustRespond, name) =>
            t(this.lang, mustRespond ? 'sub.skipViolated' : 'sub.silentSkip', { name }),
        },
        entry.mustRespond === true,
      );

      if (pubOutcome.wasSilent) {
        // silent: 管线已发通知;零气泡零 trace(点名违规跳过同样不落 trace——无有效产出)
        runOneTraceId = null;
        return;
      }

      // 一次物理调用一份完整 Trace(traceId = 首气泡 messageId,与管线令牌一致;先落 trace 再作废令牌)
      recordTraceOnce(outcome.result);
      runOneTraceId = null;

      await this.deps.persistRoom();
      this.maybeCompact(member);

      // 关键防连击: 同步已读位点并重置该发言成员的心跳冷却
      this.subscribeEngine.markMemberSpoken(member.id);

      // 扣减预算: 仅在自由订阅讨论状态(subscribe)扣减; 显式 @all(roundrobin) 或用户点名不截断
      if (this.state === 'subscribe') {
        this.budget--;
        if (this.budget <= 0) {
          await this.sysMessage(t(this.lang, 'orch.autoBudgetReached'));
          this.subscribeEngine.stop();
          this.bumpGeneration();
          this.setState('idle');
          return;
        }
      }
    } else {
      const userNames = [...USER_NAME_ALIASES];
      if (this.deps.room.userPersona?.name) userNames.push(this.deps.room.userPersona.name);
      const baton = (batonActive && genAtStart === this.generation)
        ? parseBaton(outcome.result, this.deps.room.members, member.id, userNames)
        : {};

      // 接棒模式: 剥除私聊尾行与接棒尾行(参考私聊/握手做法，正文不残留控制指令)
      finalText = stripAudienceLine(finalText);
      finalText = stripBatonLine(finalText);

      const nextMember = baton.nextMemberId
        ? this.deps.room.members.find((m) => m.id === baton.nextMemberId)
        : undefined;

      recordTraceOnce(outcome.result || finalText);
      const msgId = runOneTraceId ?? randomUUID();
      runOneTraceId = null;
      this.memberCursors.set(member.id, msgId);
      await this.deps.pushMessage({
        id: msgId,
        roomId: this.deps.room.id,
        from: member.id,
        fromName: member.name,
        text: finalText,
        ts: Date.now(),
        audience: undefined,
        batonTarget: nextMember?.name,
        batonToUser: baton.toUser,
        detail: {
          trace,
          thinking: thinking || undefined,
          usage,
          durationMs: outcome.durationMs,
          adapter: member.adapter,
          trigger: entry.trigger,
          hasTrace: true,
        },
      });
      await this.deps.persistRoom();
      this.maybeCompact(member);

      // 接棒决策: 只在"非订阅模式 + 接棒条目 + 世代未变"时推进下步状态
      if (batonActive && genAtStart === this.generation) {
        if (baton.endDiscussion) {
          await this.sysMessage(t(this.lang, 'orch.discussionEnd', { name: member.name }));
          this.setState('idle');
          return;
        }
        if (baton.toUser) {
          await this.sysMessage(t(this.lang, 'orch.handBack', { name: member.name }));
          this.setState('idle');
          return;
        }
        if (!nextMember) {
          await this.sysMessage(t(this.lang, 'orch.noNext', { name: member.name }));
          this.setState('idle');
          return;
        }
        if (entry.batonMode === 'callout') {
          this.pendingNextId = nextMember.id;
          await this.sysMessage(t(this.lang, 'orch.pendingStandby', { name: member.name, next: nextMember.name }));
          this.setState('idle');
          return;
        }
        if (this.budget <= 0) {
          this.pendingNextId = nextMember.id;
          await this.sysMessage(t(this.lang, 'orch.batonBudgetReached'));
          this.setState('idle');
          return;
        }
        this.budget--;
        await this.sysMessage(t(this.lang, 'orch.batonPass', { name: member.name, next: nextMember.name }));
        this.enqueue({
          memberId: nextMember.id,
          trigger: t(this.lang, 'orch.trigger.batonToYou', { name: member.name }),
          batonMode: 'chain',
        });
        return;
      }
    }

    // 轮次结束:轮流跑完回 idle
    if (entry.afterRounds === 'roundsEnd') {
      await this.sysMessage(t(this.lang, 'orch.roundsEnd'));
      this.setState('idle');
      return;
    }
  }

  /**
   * 记录消息对 stateful 成员的累计条数(所有消息的唯一计数收口,由 ChatRoom.pushMessage 调用)。
   * 语义:该成员"可见的对话量"(公聊全员 +1,私聊仅当事人 +1);系统消息与侦察报告不计入。
   */
  noteMessageForCompact(msg: ChatMessage): void {
    if ((this.deps.room.contextMode ?? 'stateless') !== 'stateful') return;
    if (msg.system || msg.from === 'scout' || !msg.text?.trim()) return;

    const isPrivate = Array.isArray(msg.audience) && msg.audience.length > 0;
    for (const m of this.deps.room.members) {
      if (isPrivate) {
        if (msg.from === m.id || msg.audience?.includes(m.id)) {
          this.memberMsgCounts.set(m.id, (this.memberMsgCounts.get(m.id) ?? 0) + 1);
        }
      } else {
        this.memberMsgCounts.set(m.id, (this.memberMsgCounts.get(m.id) ?? 0) + 1);
      }
    }
  }

  /**
   * 检查并在满足条件时异步执行 stateful 成员会话压缩
   */
  private maybeCompact(member: MemberConfig) {
    if ((this.deps.room.contextMode ?? 'stateless') !== 'stateful') return;
    const threshold = this.deps.summaryCfg?.compactThreshold ?? 40;
    if (threshold <= 0) return;

    const sessionId = member.sessionIds?.[member.adapter];
    if (!sessionId) return;

    const count = this.memberMsgCounts.get(member.id) ?? 0;
    if (count <= threshold) return;

    if (this.compactingPromises.has(member.id)) return;
    if ((this.compactFailures.get(member.id) ?? 0) >= 2) return;

    const entry = this.deps.adapterConfigs[member.adapter];
    if (!entry) return;

    // 清零计数并上锁
    this.memberMsgCounts.set(member.id, 0);

    const adapter = this.deps.resolveAdapter(member.adapter);
    const compactP = executeCompactSession({
      member,
      sessionId,
      model: this.deps.summaryCfg?.model ?? 'haiku',
      kind: entry.kind ?? member.adapter,
      adapter,
      command: entry.command,
      args: entry.args,
    });
    // 存 promise 而非 Set 标记: invokeWithRetry 可直接 await 它,等待被 compact 超时上界自然约束
    const tracked = compactP
      .then((ok) => {
        if (ok) {
          this.compactFailures.set(member.id, 0);
        } else {
          const prev = this.compactFailures.get(member.id) ?? 0;
          this.compactFailures.set(member.id, prev + 1);
        }
        return ok;
      })
      .catch((err) => {
        console.error(`[orchestrator] 成员 ${member.name} compact 失败:`, err);
        const prev = this.compactFailures.get(member.id) ?? 0;
        this.compactFailures.set(member.id, prev + 1);
        return false;
      })
      .finally(() => {
        // 仅在仍是本次 promise 时清除(防御极端下新的 compact 已顶替)
        if (this.compactingPromises.get(member.id) === tracked) {
          this.compactingPromises.delete(member.id);
        }
      });
    this.compactingPromises.set(member.id, tracked);
  }

  /** invoke + resume 失败自愈 */
  private async invokeWithRetry(
    member: MemberConfig,
    prompt: string,
    resumeSessionId?: string,
  ): Promise<Awaited<ReturnType<Orchestrator['invoke']>>> {
    // 防并发踩踏: 若该成员正在后台执行 /compact, 等待其释放 session
    // (等待被 compact 自身的超时上界约束——oneShotSpeak 超时必 resolve,不会无限等)
    const compacting = this.compactingPromises.get(member.id);
    if (compacting) {
      await compacting.catch(() => {});
    }

    const first = await this.invoke(member, prompt, resumeSessionId);

    if (first.outcome.status !== 'error') return first;
    if (resumeSessionId) {
      // 优雅自愈降级: 如果使用 resume 发生错误，清理失效的 session 并使用全量 Prompt 降级重试一次
      delete member.sessionIds![member.adapter];
      this.memberCursors.delete(member.id);
      await this.deps.persistRoom();
      const fallbackPrompt = await buildPrompt(this.deps.room, member, this.historySnapshot(), {
        summary: this.deps.getSummary?.(),
      });
      return this.invoke(member, fallbackPrompt, undefined);
    }
    return first;
  }

  private async invoke(
    member: MemberConfig,
    prompt: string,
    resumeSessionId?: string,
  ): Promise<{
    outcome: SpeakOutcome;
    trace: import('./types').TraceEntry[];
    thinking: string;
    usage: NonNullable<ChatMessage['detail']>['usage'];
    req: import('../adapters/base').SpeakRequest;
  }> {
    const acfg = this.deps.adapterConfigs[member.adapter];
    if (!acfg) {
      return {
        outcome: { status: 'error', result: '', durationMs: 0, error: t(this.lang, 'sys.adapterMissing', { key: member.adapter }) },
        trace: [], thinking: '', usage: undefined,
        req: { member: member.id, prompt, command: '', args: [] },
      };
    }
    const adapter = this.deps.resolveAdapter(member.adapter);

    this.statuses[member.id] = 'thinking';
    if (!this.currentSpeaker) {
      this.currentSpeaker = member.id;
    }
    this.onStatuses();

    const trace: import('./types').TraceEntry[] = [];
    let thinking = '';
    let usage: NonNullable<ChatMessage['detail']>['usage'] = undefined;

    const req: import('../adapters/base').SpeakRequest = {
      member: member.id,
      prompt,
      command: acfg.command,
      args: [...acfg.args, ...(member.extraArgs ?? [])],
      cwd: this.deps.room.projectPath || undefined,
      resumeSessionId,
      permission: this.deps.room.toolPermission,
    };

    const handle = adapter.speak(req, (ev: AgentEvent) => {
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

    const cancelFn = () => handle.cancel();
    this.activeCancels.add(cancelFn);

    try {
      const outcome = await handle.done;
      return { outcome, trace, thinking, usage, req };
    } finally {
      this.activeCancels.delete(cancelFn);
      if (this.currentSpeaker === member.id) {
        this.currentSpeaker = undefined;
      }
    }
  }

  // ---------- @指令解析 ----------

  private parseUserCommand(text: string):
    | { kind: 'start'; member: MemberConfig; fromName: string }
    | { kind: 'mention'; member?: MemberConfig; members: MemberConfig[] }
    | { kind: 'all'; rounds: number }
    | { kind: 'none' } {
    // <接棒>@xx / <pass>@xx / 【接棒】@xx(与 agent 同一语法,双语并集):直接指定起手进链
    const startMatch = text.match(BATON_LINE);
    if (startMatch) {
      const directive = (startMatch[1] ?? '').trim();
      const nameHit = directive.match(AT_NAME);
      const rawName = (nameHit?.[1] ?? directive).trim();
      const hit = rawName ? matchMemberByName(rawName, this.deps.room.members) : undefined;
      if (hit) return { kind: 'start', member: hit, fromName: this.deps.room.userPersona?.name || t(this.lang, 'sys.user') };
      return { kind: 'none' };
    }
    // @allN 轮流:负向前瞻防吞 "all" 开头的成员名(@allan 落入下方成员名匹配)。
    // 保留字优先:名为 "all3" 的成员无法被 @all3 点到(恒解析为 3 轮轮流)——文档写明的边界。
    const allMatch = text.match(/@all(\d*)(?![^\s@,，。])/);
    if (allMatch) {
      return { kind: 'all', rounds: allMatch[1] ? Math.max(1, parseInt(allMatch[1])) : 1 };
    }
    const atNames = [...text.matchAll(AT_NAME_GLOBAL)].map((mm) => mm[1]!);
    const matchedMembers: MemberConfig[] = [];
    for (const raw of atNames) {
      const hit = matchMemberByName(raw, this.deps.room.members);
      if (hit && !matchedMembers.some((m) => m.id === hit.id)) {
        matchedMembers.push(hit);
      }
    }
    if (matchedMembers.length > 0) {
      return { kind: 'mention', members: matchedMembers, member: matchedMembers[0] };
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
