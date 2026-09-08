// 订阅模式: 私聊握手协议与 3 条硬闸熔断控制器。

import type { HandshakeDirective } from './audience';

export interface PrivateThread {
  threadId: string;
  /** 全局私聊会话序号 (第 1 场私聊、第 2 场私聊...) */
  index: number;
  initiatorId: string;
  targetId: string;
  count: number;
  status: 'active' | 'closed';
  createdAt: number;
}

export class PrivateChatProtocol {
  private threads: Map<string, PrivateThread> = new Map();
  // 记录 memberId 最近参与的 active threadId
  private activeThreadByMember: Map<string, string> = new Map();
  private threadCounter = 0;

  setThreadCounter(val: number): void {
    if (val > this.threadCounter) {
      this.threadCounter = val;
    }
  }

  getThreadCounter(): number {
    return this.threadCounter;
  }

  /**
   * 发起一场新私聊 (计数 1)
   */
  startThread(initiatorId: string, targetId: string): PrivateThread {
    if (initiatorId === targetId) {
      throw new Error(`禁止对自己发起私聊: initiatorId === targetId (${initiatorId})`);
    }

    // 检查双方之间是否已有活跃的私聊通道，若有则直接复用
    const existing = this.getActiveThreadBetween(initiatorId, targetId);
    if (existing) {
      return existing;
    }

    this.threadCounter++;
    const threadId = `th_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const thread: PrivateThread = {
      threadId,
      index: this.threadCounter,
      initiatorId,
      targetId,
      count: 1,
      status: 'active',
      createdAt: Date.now(),
    };
    this.threads.set(threadId, thread);
    this.activeThreadByMember.set(initiatorId, threadId);
    this.activeThreadByMember.set(targetId, threadId);
    return thread;
  }

  /**
   * 查找指定两名成员之间是否存在活跃的私聊 Thread (无向对等)
   */
  getActiveThreadBetween(a: string, b: string): PrivateThread | undefined {
    for (const thread of this.threads.values()) {
      if (
        thread.status === 'active' &&
        ((thread.initiatorId === a && thread.targetId === b) ||
          (thread.initiatorId === b && thread.targetId === a))
      ) {
        return thread;
      }
    }
    return undefined;
  }

  /**
   * 获取成员当前处于活跃状态的私聊 Thread
   */
  getActiveThread(memberId: string): PrivateThread | undefined {
    const tid = this.activeThreadByMember.get(memberId);
    if (!tid) return undefined;
    const thread = this.threads.get(tid);
    if (!thread || thread.status === 'closed') {
      this.activeThreadByMember.delete(memberId);
      return undefined;
    }
    return thread;
  }

  /**
   * 处理私聊回应，推进计数并应用 3 条硬闸规则
   * @param threadId 当前私聊 Thread ID
   * @param senderId 发言者 ID
   * @param handshake 握手指令 (<同意> / <拒绝> / <想法>)
   * @returns 处理结果，含更新后的 thread 及是否允许继续
   */
  handleResponse(
    threadId: string,
    senderId: string,
    handshake?: HandshakeDirective,
  ): { thread: PrivateThread; allowed: boolean; isClosed: boolean } {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`私聊会话未找到: ${threadId}`);
    }

    if (thread.status === 'closed') {
      return { thread, allowed: false, isClosed: true };
    }

    thread.count++;

    // 握手终结: <同意> 或 <拒绝>
    if (handshake?.type === 'agree' || handshake?.type === 'reject') {
      thread.status = 'closed';
      this.activeThreadByMember.delete(thread.initiatorId);
      this.activeThreadByMember.delete(thread.targetId);
      return { thread, allowed: true, isClosed: true };
    }

    // 3 条硬闸强制熔断: 达到 3 条直接关闭
    if (thread.count >= 3) {
      thread.status = 'closed';
      this.activeThreadByMember.delete(thread.initiatorId);
      this.activeThreadByMember.delete(thread.targetId);
      return { thread, allowed: true, isClosed: true };
    }

    return { thread, allowed: true, isClosed: false };
  }

  getThread(threadId: string): PrivateThread | undefined {
    return this.threads.get(threadId);
  }

  /**
   * 关闭指定成员参与的全部私聊线程(成员被移除时调用)。
   * 硬边界:成员 id 已不在房间,线程里的对端永远无法回应,全部关闭语义自洽;
   * 防止 getActiveThread 继续返回"对端不存在"的幽灵通道。
   */
  closeThreadsForMember(memberId: string): void {
    for (const thread of this.threads.values()) {
      if (
        thread.status === 'active' &&
        (thread.initiatorId === memberId || thread.targetId === memberId)
      ) {
        thread.status = 'closed';
        this.activeThreadByMember.delete(thread.initiatorId);
        this.activeThreadByMember.delete(thread.targetId);
      }
    }
  }

  clear(): void {
    this.threads.clear();
    this.activeThreadByMember.clear();
  }
}
