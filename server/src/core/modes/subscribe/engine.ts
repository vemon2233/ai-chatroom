// 订阅模式: 去中心化心跳式自主群聊领域引擎。
// 职责:
// 1. 独立管理各 Agent 独立心跳 Timer (15s + 1~3s 随机错峰);
// 2. 增量未读消息视窗感知(零新消息不拉起 CLI, 极度省 Token);
// 3. 一步全价自决, 拦截 <沉默> 零落库零广播;
// 4. 私聊握手协议追踪与 3 条硬闸强制熔断;
// 5. 同 Agent 严格并发互斥(绝不同时跑两个 CLI 进程);
// 6. 全生命周期销毁(stop 时 100% 清理所有 Timer, 杜绝幽灵调用与内存泄漏)。

import type { ChatMessage, MemberConfig, RoomConfig } from '../../types';
import {
  parseAudience,
  parseHandshake,
  splitPublicAndPrivateMessage,
  stripAudienceLine,
} from './audience';
import { PrivateChatProtocol } from './protocol';
import { buildHeartbeatPrompt, isSilentDecision } from './prompt';
import { matchMemberByName } from '../../prompt';

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
  }>;
  /** 发布消息到房间 (落库并推前端) */
  publishMessage: (msg: {
    from: string;
    fromName: string;
    text: string;
    audience?: string[];
    threadId?: string;
    handshake?: 'agree' | 'reject' | 'idea';
    privateRound?: number;
    privateAction?: 'start' | 'agree' | 'reject' | 'idea' | 'reply';
    detail?: {
      trace?: any[];
      thinking?: string;
      usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
      durationMs?: number;
    };
  }) => Promise<void>;
  /** 系统通知 */
  sysMessage: (text: string) => Promise<void>;
  /** 扣减轮次预算, 若已耗尽返回 false */
  consumeBudget: () => boolean;
  /** 当消息中包含 @点名 时, 立即唤醒被 @ 成员响应 */
  onMentioned: (targetMember: MemberConfig, triggerReason: string) => Promise<void>;
  /** 检查编排器全局是否正在执行推理或有待发言任务 */
  isBusy?: () => boolean;
  /** 状态机切回 idle 通知 */
  onIdle: () => void;
}

export class SubscribeEngine {
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
   * 启动全员错峰独立心跳
   */
  start(members: MemberConfig[]): void {
    this.stop(); // 启动前彻底清空旧定时器
    this.isRunning = true;
    this.isSpeaking = false;
    this.speakerQueue = [];

    // 同步历史消息中的最大私聊会话编号
    const history = this.deps.getHistory();
    let maxRound = 0;
    for (const msg of history) {
      if (msg.privateRound && msg.privateRound > maxRound) {
        maxRound = msg.privateRound;
      }
    }
    this.protocol.setThreadCounter(maxRound);

    // 记录各成员当前的起始查看位点
    const historyLen = history.length;
    members.forEach((m, idx) => {
      if (!this.lastSeenIndices.has(m.id)) {
        this.lastSeenIndices.set(m.id, Math.max(0, historyLen - 1));
      }
      // 阶梯式启动错峰: 充分拉大初始距离 (第1人 1~3s, 第2人 8~12s, 第3人 16~20s)
      const initialDelay = idx * 8000 + Math.floor(Math.random() * 3000) + 1000;
      this.scheduleHeartbeatWithDelay(m, initialDelay);
    });
  }

  getProtocol(): PrivateChatProtocol {
    return this.protocol;
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
   * 停止全员心跳，销毁全部定时器与互斥状态
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
    this.protocol.clear();
  }

  /**
   * 当房间出现新消息时更新引擎态
   */
  onNewMessage(): void {
    // 心跳周期自然推进, 增量位点会在各 Agent 醒来时动态计算
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
      if (lastMsg.from === member.id) {
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

      const prompt = buildHeartbeatPrompt(room, member, delta, activeThread, otherMemberName);
      const outcome = await this.deps.speak(member, prompt);

      if (outcome.status !== 'ok' || !outcome.result) {
        return;
      }

      const rawText = outcome.result;

      // 4. 自决判定: 若输出 <跳过> 或 <沉默>，发出系统通知，零落库零广播
      if (isSilentDecision(rawText)) {
        console.log(`[subscribe] 成员 ${member.name} 心跳后决定跳过 <跳过>`);
        await this.deps.sysMessage(`${member.name} 评估暂无发言与私聊意向，选择跳过。`);
        return;
      }

      // 5. 扣减发言预算 (心跳发言 + @唤醒发言 = 严格上限)
      const budgetOk = this.deps.consumeBudget();
      if (!budgetOk) {
        await this.deps.sysMessage('讨论已达自动发言上限,发条新消息可继续。');
        this.stop();
        this.deps.onIdle();
        return;
      }

      // 6. 消息解析: 拆分公聊发言与私聊发言 (支持单公聊 + 多私聊独立气泡解构，严禁对自己发私信)
      const split = splitPublicAndPrivateMessage(rawText, room.members, member.id);

      // 如果公聊和私聊都未解析出有效内容，以 stripAudienceLine 作为公聊兜底
      if (!split.publicText && (!split.privateBlocks || split.privateBlocks.length === 0)) {
        split.publicText = stripAudienceLine(rawText) || rawText;
      }

      // 组装思考过程与用量详情
      const speechDetail = {
        trace: outcome.trace || [],
        thinking: outcome.thinking,
        usage: outcome.usage,
        durationMs: outcome.durationMs,
      };

      // 7. 发布消息 (气泡拆分: 若既有公聊又有私聊，依次发布独立消息)
      // 7.1 发布公聊消息 (全员可见气泡)
      if (split.publicText) {
        await this.deps.publishMessage({
          from: member.id,
          fromName: member.name,
          text: split.publicText,
          audience: undefined,
          threadId: undefined,
          detail: speechDetail,
        });
        await this.checkAndTriggerMentions(member, split.publicText);
      }

      // 7.2 发布私聊消息 (支持针对不同/相同目标成员拆解出多个独立私聊气泡)
      if (split.privateBlocks && split.privateBlocks.length > 0) {
        for (const block of split.privateBlocks) {
          const primaryTargetId = block.targetMemberIds[0];
          if (!primaryTargetId || !block.privateText) continue;

          const meta = this.resolvePrivateMeta(member.id, primaryTargetId, block.handshake);
          await this.deps.publishMessage({
            from: member.id,
            fromName: member.name,
            text: block.privateText,
            audience: block.targetMemberIds,
            threadId: meta.threadId,
            handshake: block.handshake,
            privateRound: meta.privateRound,
            privateAction: meta.privateAction,
            detail: speechDetail,
          });
          await this.checkAndTriggerMentions(
            member,
            block.privateText,
            block.targetMemberIds,
            block.handshake ? { type: block.handshake } : undefined,
          );
        }
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
        await this.deps.onMentioned(target, `同事 ${speaker.name} 在私聊中对你提出了新想法，请回应。`);
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
        await this.deps.onMentioned(hit, `同事 ${speaker.name} 在发言中点名提及了你。`);
        this.resetMemberHeartbeat(hit.id);
      }
    }
  }
}
