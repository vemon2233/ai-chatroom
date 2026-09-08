// 订阅模式: 去中心化心跳式自主群聊领域引擎。
// 职责:
// 1. 独立管理各 Agent 独立心跳 Timer (15s + 1~3s 随机错峰);
// 2. 增量未读消息视窗感知(零新消息不拉起 CLI, 极度省 Token);
// 3. 一步全价自决, 拦截 <沉默> 零落库零广播;
// 4. 私聊握手协议追踪与 3 条硬闸强制熔断;
// 5. 同 Agent 严格并发互斥(绝不同时跑两个 CLI 进程);
// 6. 全生命周期销毁(stop 时 100% 清理所有 Timer, 杜绝幽灵调用与内存泄漏)。

import type { AgentTraceLog, ChatMessage, MemberConfig, RoomConfig } from '../../types';
import { matchMemberByName } from '../../naming';
import { PrivateChatProtocol } from './protocol';
import { buildHeartbeatPrompt, isSilentDecision } from './prompt';
import { publishSpeechResult } from './publish';
import { t } from '../../i18n/messages';
import { DEFAULT_LANG, type Lang, type LangGetter } from '../../i18n/lang';

/** 心跳调用素材(供首气泡落一份完整 Trace;由 orchestrator.speak 回调返回) */
export interface HeartbeatInvocation {
  prompt: string;
  command: string;
  args: string[];
  cwd?: string;
  resumeSessionId?: string;
}

export interface SubscribeEngineDeps {
  getRoom: () => RoomConfig;
  getHistory: () => ChatMessage[];
  /** 执行单次 Agent 发言调用 (由外部 Orchestrator 提供基础执行管道) */
  speak: (member: MemberConfig, prompt: string) => Promise<{
    result?: string;
    status: string;
    error?: string;
    trace?: any[];
    thinking?: string;
    usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
    durationMs?: number;
    /** 完整调用素材(trace 落库用) */
    invocation?: HeartbeatInvocation;
  }>;
  /** 发布消息到房间 (落库并推前端;由管线组装完整 ChatMessage) */
  publishMessage: (msg: ChatMessage) => Promise<void>;
  /** 系统通知 */
  sysMessage: (text: string) => Promise<void>;
  /** 语言注入(未注入 → zh,与改造前逐字节一致) */
  getLang?: LangGetter;
  /** 扣减轮次预算, 若已耗尽返回 false */
  consumeBudget: () => boolean;
  /** 当消息中包含 @点名 时, 立即唤醒被 @ 成员响应 */
  onMentioned: (targetMember: MemberConfig, triggerReason: string) => Promise<void>;
  /** 检查编排器全局是否正在执行推理或有待发言任务 */
  isBusy?: () => boolean;
  /** 状态机切回 idle 通知 */
  onIdle: () => void;
  /** 获取当前讨论上下文摘要(供心跳注入长程记忆) */
  getSummaryContext?: () => { summary?: import('../../types').DiscussionSummary | null };
  /** Trace 落库接缝(未注入时跳过——测试场景) */
  saveTrace?: (scope: 'room' | 'direct', id: string, trace: AgentTraceLog) => Promise<void>;
}


export class SubscribeEngine {

  /** 当前语言(发射时刻取值;未注入恒 zh——现状不变量) */
  private get lang(): Lang {
    return this.deps.getLang?.() ?? DEFAULT_LANG;
  }
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private locks: Set<string> = new Set();
  private lastSeenIndices: Map<string, number> = new Map();
  private protocol = new PrivateChatProtocol();
  private isRunning = false;
  /** 当前引擎内部是否有心跳发言在执行 */
  private isSpeaking = false;
  /** 外部 (如 @点名唤醒队列) 是否正在执行思考发言 */
  private isExternalSpeaking = false;
  /** 心跳到达但因有人在发言而排队的成员队列 (FIFO) */
  private speakerQueue: MemberConfig[] = [];

  constructor(private deps: SubscribeEngineDeps) {}

  /**
   * 从持久化历史重建私聊协议(服务重启后由 ChatRoom.restore 调用,同步纯内存微秒级)。
   * 派生规则(尽力恢复,不做完美考古):
   *  - 只认带 threadId 的消息(早期无 threadId 的旧消息跳过——重启后本来就丢);
   *  - pair = from ↔ audience[0](沿用单 target 语义,多播不引入新协议能力);
   *  - 组末条 handshake 为 agree/reject → closed,否则 active;
   *  - count = min(组内消息数, 2):保守重建,宁可提前熔断绝不放行超限
   *    (3 条硬闸是安全机制;也消灭"第 5/3 轮"荒谬展示);
   *  - threadCounter 取 max(重建线程最大 index, 历史 privateRound)——防撞号,
   *    从猜测上限升级为事实上限。
   */
  rebuildFromHistory(history: readonly ChatMessage[]): void {
    interface Rebuilt {
      threadId: string;
      index: number;
      initiatorId: string;
      targetId: string;
      count: number;
      status: 'active' | 'closed';
      lastHandshake?: 'agree' | 'reject' | 'idea';
      createdAt: number;
      maxTs: number;
    }
    const byThread = new Map<string, Rebuilt>();

    for (const m of history) {
      if (!m.threadId || !m.audience || m.audience.length === 0) continue;
      const targetId = m.audience[0]!;
      if (targetId === m.from) continue; // 自私聊防御(不应存在)
      const existing = byThread.get(m.threadId);
      if (existing) {
        existing.count += 1;
        if (m.ts >= existing.maxTs) {
          existing.maxTs = m.ts;
          existing.lastHandshake = m.handshake;
        }
      } else {
        byThread.set(m.threadId, {
          threadId: m.threadId,
          index: m.privateRound ?? 0,
          initiatorId: m.from,
          targetId,
          count: 1,
          status: 'active',
          lastHandshake: m.handshake,
          createdAt: m.ts,
          maxTs: m.ts,
        });
      }
    }

    const threads: Array<{
      threadId: string;
      index: number;
      initiatorId: string;
      targetId: string;
      count: number;
      status: 'active' | 'closed';
      createdAt: number;
    }> = [];
    let maxIndex = 0;
    for (const t of byThread.values()) {
      const closed =
        t.status === 'closed' || t.lastHandshake === 'agree' || t.lastHandshake === 'reject';
      threads.push({
        threadId: t.threadId,
        index: t.index,
        initiatorId: t.initiatorId,
        targetId: t.targetId,
        count: Math.min(t.count, 2), // 保守重建:上限 2,下一条回应即触闸
        status: closed ? 'closed' : 'active',
        createdAt: t.createdAt,
      });
      if (t.index > maxIndex) maxIndex = t.index;
    }
    this.protocol.rebuild(threads);

    // counter 防撞号:重建 index 与历史 privateRound 取最大(事实上限)
    let maxRound = maxIndex;
    for (const m of history) {
      if (m.privateRound && m.privateRound > maxRound) maxRound = m.privateRound;
    }
    this.protocol.setThreadCounter(maxRound);
  }

  /**
   * 启动全员错峰独立心跳
   */
  start(members: MemberConfig[]): void {
    this.stop(); // 启动前彻底清空旧定时器
    this.isRunning = true;
    this.isSpeaking = false;
    this.speakerQueue = [];

    // 同步历史消息的最大私聊会话编号(防新线程编号与历史撞号)。
    // 注:restore 时 rebuildFromHistory 已从事实上限设置 counter 并重建线程簿记;
    // 此处仅在协议为空时兜底(如老房间未走重建路径),避免双份派生逻辑并存。
    if (this.protocol.getThreadCounter() === 0) {
      let maxRound = 0;
      for (const msg of this.deps.getHistory()) {
        if (msg.privateRound && msg.privateRound > maxRound) {
          maxRound = msg.privateRound;
        }
      }
      this.protocol.setThreadCounter(maxRound);
    }

    // 记录各成员当前的起始查看位点
    const historyLen = this.deps.getHistory().length;
    members.forEach((m, idx) => {
      if (!this.lastSeenIndices.has(m.id)) {
        this.lastSeenIndices.set(m.id, Math.max(0, historyLen - 1));
      }
      // 阶梯式启动错峰: 充分拉大初始距离 (第1人 1~3s, 第2人 8~12s, 第3人 16~20s)
      const initialDelay = idx * 8000 + Math.floor(Math.random() * 3000) + 1000;
      this.scheduleHeartbeatWithDelay(m, initialDelay);
    });
  }

  private currentExternalSpeakerId?: string;

  /** 设置外部执行态 (如 @点名或随机起头队列是否正在执行思考) */
  setExternalSpeaking(val: boolean, speakerId?: string): void {
    this.isExternalSpeaking = val;
    this.currentExternalSpeakerId = val ? speakerId : undefined;
  }

  /** 检查当前是否有人在发言或思考 */
  isSpeakingNow(): boolean {
    return this.isSpeaking || this.isExternalSpeaking;
  }

  /** 尝试消耗排队中的下一个等待者 */
  drainSpeakerQueue(): void {
    if (!this.isRunning) return;
    if (this.isSpeaking || this.isExternalSpeaking || (this.deps.isBusy && this.deps.isBusy())) return;
    const nextMember = this.speakerQueue.shift();
    if (nextMember && this.isRunning) {
      void this.runHeartbeatTick(nextMember);
    }
  }

  /**
   * 停止全员心跳，销毁全部定时器与互斥状态。
   * 注意:不清理私聊协议(protocol)——用户插话/点停止都不该击穿私聊线程的
   * 3 条硬闸与通道上下文(旧行为:任何用户消息都 start()→stop()→clear(),
   * 导致硬闸被无限重置)。协议全清只挂在真正的历史重置(clearMessages)上,
   * 经 clearProtocol() 显式调用。
   */
  stop(): void {
    this.isRunning = false;
    this.isSpeaking = false;
    this.currentExternalSpeakerId = undefined;
    this.speakerQueue = [];
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.locks.clear();
  }

  /** 彻底清空私聊协议(仅历史重置场景:clearMessages;成员移除走 closeThreadsForMember) */
  clearProtocol(): void {
    this.protocol.clear();
  }

  /** 成员被移除:关闭 TA 参与的全部私聊线程(对端永远无法回应) */
  closeThreadsForMember(memberId: string): void {
    this.protocol.closeThreadsForMember(memberId);
  }

  /**
   * 解析或推进私聊会话状态并返回标准元数据 (供 engine 及外部 orchestrator 统一复用，彻底消灭跨层重复)
   */
  resolvePrivateMeta(
    senderId: string,
    targetId: string,
    handshake?: 'agree' | 'reject' | 'idea',
  ): {
    threadId: string;
    privateRound: number;
    privateAction: 'start' | 'agree' | 'reject' | 'idea' | 'reply';
  } {
    const existing = this.protocol.getActiveThreadBetween(senderId, targetId);
    if (existing && existing.status === 'active') {
      const { thread, isClosed } = this.protocol.handleResponse(
        existing.threadId,
        senderId,
        handshake ? { type: handshake } : undefined,
      );
      if (isClosed) {
        console.log(`[subscribe] 私聊会话 ${existing.threadId} 达成终结或达到 3 条硬闸熔断`);
      }
      return {
        threadId: existing.threadId,
        privateRound: thread.index,
        privateAction: handshake ?? 'reply',
      };
    }
    const newThread = this.protocol.startThread(senderId, targetId);
    return {
      threadId: newThread.threadId,
      privateRound: newThread.index,
      privateAction: 'start',
    };
  }

  /**
   * 重置指定成员的心跳定时器 (例如刚完成被 @ 响应或作为起头者发言)
   */
  resetMemberHeartbeat(memberId: string): void {
    const timer = this.timers.get(memberId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(memberId);
    }
    const member = this.deps.getRoom().members.find((m) => m.id === memberId);
    if (member && this.isRunning) {
      this.scheduleHeartbeat(member);
    }
  }

  /**
   * 当成员在外部完成发言(如被 @ 响应或作为起头者发言)后，同步已读位点并进入心跳冷却
   */
  markMemberSpoken(memberId: string): void {
    const allHistory = this.deps.getHistory();
    this.lastSeenIndices.set(memberId, allHistory.length);
    // 从排队队列中移除自己，防止自排队连击
    this.speakerQueue = this.speakerQueue.filter((m) => m.id !== memberId);
    this.resetMemberHeartbeat(memberId);
  }

  /**
   * 安排一次独立心跳调度(带成员个性偏置与拉长的抖动)
   */
  private scheduleHeartbeat(member: MemberConfig): void {
    if (!this.isRunning) return;

    // 基础心跳拉长到 25 秒
    const baseMs = this.deps.getRoom().subscribeConfig?.heartbeatIntervalMs ?? 25000;
    // 根据 member.id 生成稳定的成员个性周期偏置 (0 ~ 9000ms)，避免全员同频共振
    const memberOffset = (member.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 4) * 3000;
    // 随机抖动 3~8 秒
    const jitter = Math.floor(Math.random() * 5000) + 3000;
    const delay = baseMs + memberOffset + jitter;

    this.scheduleHeartbeatWithDelay(member, delay);
  }

  /**
   * 按指定毫秒延时挂载心跳定时器
   */
  private scheduleHeartbeatWithDelay(member: MemberConfig, delay: number): void {
    if (!this.isRunning) return;

    const timer = setTimeout(async () => {
      this.timers.delete(member.id);
      if (!this.isRunning) return;

      try {
        await this.runHeartbeatTick(member);
      } catch (err) {
        console.error(`[subscribe] 成员 ${member.name} 心跳执行异常:`, err);
      } finally {
        if (this.isRunning) {
          this.scheduleHeartbeat(member);
        }
      }
    }, delay);

    this.timers.set(member.id, timer);
  }

  /**
   * 单个成员的心跳唤醒核心逻辑
   */
  private async runHeartbeatTick(member: MemberConfig): Promise<void> {
    // 1. 同 Agent 互斥锁防御: 若该 Agent 当前正在执行 (如响应@或起头发言), 跳过本次心跳
    if (this.locks.has(member.id) || this.currentExternalSpeakerId === member.id) {
      return;
    }

    // 2. 检查全局是否已有成员在发言: 若有，进入 FIFO 队列排队（自己绝不排自己的队）
    if (this.isSpeaking || this.isExternalSpeaking || (this.deps.isBusy && this.deps.isBusy())) {
      if (this.currentExternalSpeakerId !== member.id && !this.speakerQueue.some((m) => m.id === member.id)) {
        this.speakerQueue.push(member);
      }
      return;
    }

    // 3. 计算自上次以来的增量消息窗口
    const allHistory = this.deps.getHistory();
    const lastIdx = this.lastSeenIndices.get(member.id) ?? 0;
    const delta = allHistory.slice(lastIdx);

    // 若无任何新消息，直接跳过本次心跳，绝不浪费全价调用
    if (delta.length === 0) {
      return;
    }

    // 4. 防连续发言抑制 (Last-Speaker Suppression):
    // 如果房间成员 > 1，且群里最后一条消息正是自己发的，
    // 则主动避让，将麦克风留给其他成员，绝不连发第二次
    const room = this.deps.getRoom();
    if (room.members.length > 1 && allHistory.length > 0) {
      const lastMsg = allHistory[allHistory.length - 1];
      if (lastMsg && lastMsg.from === member.id) {
        // 标记位点已读，避让给他人
        this.lastSeenIndices.set(member.id, allHistory.length);
        return;
      }
    }

    // 抢占发言互斥锁
    this.isSpeaking = true;
    this.locks.add(member.id);
    // 标记当前处理到的消息位点
    this.lastSeenIndices.set(member.id, allHistory.length);

    try {
      const room = this.deps.getRoom();
      const activeThread = this.protocol.getActiveThread(member.id);
      let otherMemberName: string | undefined;
      if (activeThread) {
        const otherId = activeThread.initiatorId === member.id ? activeThread.targetId : activeThread.initiatorId;
        const other = room.members.find((m) => m.id === otherId);
        otherMemberName = other?.name;
      }

      const ctx = this.deps.getSummaryContext?.();
      const isStatefulResumed =
        (room.contextMode ?? 'stateless') === 'stateful' &&
        !!member.sessionIds?.[member.adapter];
      const prompt = buildHeartbeatPrompt(
        room,
        member,
        delta,
        activeThread,
        otherMemberName,
        isStatefulResumed ? undefined : ctx?.summary,
        allHistory, // 供摘要/纪要锚点失效校验(截断后不注入幽灵摘要)
        this.lang,
      );
      const outcome = await this.deps.speak(member, prompt);

      if (outcome.status !== 'ok' || !outcome.result) {
        return;
      }

      // 4. silent 判定先行(免预算:合法跳过不烧预算;时序由心跳侧控制,判定真源在 isSilentDecision)
      //    通知与措辞由发布管线统一处理(mustRespond=false:心跳路径跳过合法)
      if (isSilentDecision(outcome.result)) {
        console.log(`[subscribe] 成员 ${member.name} 心跳后决定跳过 <跳过>`);
        await this.deps.sysMessage(t(this.lang, 'sub.silentSkip', { name: member.name }));
        return;
      }

      // 5. 扣减发言预算 (心跳发言 + @唤醒发言 = 严格上限)
      const budgetOk = this.deps.consumeBudget();
      if (!budgetOk) {
        await this.deps.sysMessage(t(this.lang, 'orch.autoBudgetReached'));
        this.stop();
        this.deps.onIdle();
        return;
      }

      // 6. 发布管线唯一真源: 拆分/兜底/发布循环/mentions 钩子收敛于 publishSpeechResult
      //    (silent 已在上方判定并返回,这里恒为非 silent 输出)
      const pubOutcome = await publishSpeechResult(
        member,
        outcome.result,
        {
          trace: outcome.trace || [],
          thinking: outcome.thinking,
          usage: outcome.usage,
          durationMs: outcome.durationMs,
          adapter: member.adapter,
          trigger: t(this.lang, 'trace.heartbeat'),
        },
        {
          roomId: room.id,
          members: room.members,
          publish: async (msg) => {
            await this.deps.publishMessage(msg);
          },
          resolvePrivateMeta: (senderId, targetId, handshake) =>
            this.resolvePrivateMeta(senderId, targetId, handshake),
          sysMessage: (text) => this.deps.sysMessage(text),
          tSilent: (mustRespond, name) =>
            t(this.lang, mustRespond ? 'sub.skipViolated' : 'sub.silentSkip', { name }),
          onPublished: async (text, audience, handshake) => {
            await this.checkAndTriggerMentions(
              member,
              text,
              audience,
              handshake ? { type: handshake } : undefined,
            );
          },
        },
      );

      // 7. 首气泡落 trace(一次物理调用一份完整 Trace;traceId = 首气泡 messageId)
      const firstId = pubOutcome.publishedIds[0];
      const inv = outcome.invocation;
      if (firstId && inv) {
        const traceLog: AgentTraceLog = {
          messageId: firstId,
          roomId: room.id,
          memberId: member.id,
          memberName: member.name,
          adapter: member.adapter,
          ts: Date.now(),
          durationMs: outcome.durationMs ?? 0,
          status: outcome.status === 'ok' ? 'ok' : outcome.status,
          error: outcome.error,
          trigger: t(this.lang, 'trace.heartbeat'),
          input: {
            prompt: inv.prompt,
            command: inv.command,
            args: inv.args,
            cwd: inv.cwd,
            resumeSessionId: inv.resumeSessionId,
          },
          output: {
            result: outcome.result,
            thinking: outcome.thinking,
            trace: outcome.trace ?? [],
            usage: outcome.usage,
          },
        };
        void this.deps.saveTrace?.('room', room.id, traceLog);
      }
    } finally {
      this.isSpeaking = false;
      this.locks.delete(member.id);
      // 触发排队中的下一个等待者
      this.drainSpeakerQueue();
    }
  }

  /**
   * 检查消息正文或私聊中的 @ 提及并立即唤醒
   */
  private async checkAndTriggerMentions(
    speaker: MemberConfig,
    text: string,
    audience?: string[],
    handshake?: import('./audience').HandshakeDirective,
  ): Promise<void> {
    const room = this.deps.getRoom();
    const otherMembers = room.members.filter((m) => m.id !== speaker.id);

    // 握手如果为 <想法> @发起方，强制唤醒发起方
    if (handshake?.type === 'idea' && handshake.targetMemberId) {
      const target = room.members.find((m) => m.id === handshake.targetMemberId);
      if (target) {
        await this.deps.onMentioned(target, t(this.lang, 'sub.dmMention', { name: speaker.name }));
        this.resetMemberHeartbeat(target.id);
        return;
      }
    }

    // 正文中普通 @点名
    const atMatches = [...text.matchAll(/@([^\s@,，。]+)/g)].map((m) => m[1]!);
    for (const name of atMatches) {
      const hit = matchMemberByName(name, otherMembers);
      if (hit) {
        // 若当前为私聊且被 @ 者不在受众中，不唤醒
        if (audience && !audience.includes(hit.id)) continue;
        await this.deps.onMentioned(hit, t(this.lang, 'sub.atMention', { name: speaker.name }));
        this.resetMemberHeartbeat(hit.id);
      }
    }
  }
}
