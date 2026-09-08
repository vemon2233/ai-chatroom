import type { ChatMessage } from './types';
import { inferHandshakeFromText } from './modes/subscribe/audience';

/**
 * 截断指定消息之后的所有后续消息(保留目标消息本身，后续消息全部清除)
 */
export function truncateMessages(messages: ChatMessage[], messageId: string): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) throw new Error(`未找到指定消息: ${messageId}`);
  return messages.slice(0, idx + 1);
}

/**
 * 准备重roll: 截断至目标发言之前(不包含目标发言本身)，并校验必须为 AI 角色发言
 */
export function prepareReroll(
  messages: ChatMessage[],
  messageId: string,
): { remaining: ChatMessage[]; targetSpeaker: string } {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) throw new Error(`未找到指定消息: ${messageId}`);
  const target = messages[idx]!;
  if (target.from === 'user' || target.system) {
    throw new Error('只能对 AI 成员的发言执行重roll');
  }
  return {
    remaining: messages.slice(0, idx),
    targetSpeaker: target.from,
  };
}

/**
 * 准备编辑: 更新目标消息文本与时间戳，清理旧 trace/detail，并截断其后消息
 */
export function prepareEdit(
  messages: ChatMessage[],
  messageId: string,
  newText: string,
): { remaining: ChatMessage[]; isUser: boolean; updatedTarget: ChatMessage } {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) throw new Error(`未找到指定消息: ${messageId}`);
  const target = { ...messages[idx]! };
  target.text = newText;
  target.ts = Date.now();
  if (target.detail) {
    target.detail = { adapter: target.detail.adapter };
  }
  const remaining = [...messages.slice(0, idx), target];
  return {
    remaining,
    isUser: target.from === 'user',
    updatedTarget: target,
  };
}

/**
 * 历史旧消息兼容补齐: 给缺少 privateRound / handshake 的存量私聊消息推算字段。
 * 数据迁移逻辑归 core(读领域模型、写领域字段);store 只返回原始 parse 结果。
 * - privateRound: 同一消息对(pair)按出现顺序分配连续编号(已有编号则沿用并推进序列)
 * - handshake/privateAction: 无显式标签时按语气语义推算(inferHandshakeFromText)
 */
export function backfillHandshake(messages: ChatMessage[]): ChatMessage[] {
  let threadSeq = 0;
  const pairThreadMap = new Map<string, number>();
  for (const m of messages) {
    if (m.audience && m.audience.length > 0) {
      const pairKey = [m.from, ...m.audience].sort().join(':');
      if (m.privateRound == null) {
        if (!pairThreadMap.has(pairKey)) {
          threadSeq++;
          pairThreadMap.set(pairKey, threadSeq);
        }
        m.privateRound = pairThreadMap.get(pairKey)!;
      } else {
        pairThreadMap.set(pairKey, m.privateRound);
        if (m.privateRound > threadSeq) threadSeq = m.privateRound;
      }

      if (!m.handshake && !m.privateAction) {
        const inferred = inferHandshakeFromText(m.text);
        if (inferred) {
          m.handshake = inferred;
          m.privateAction = inferred;
        }
      }
    }
  }
  return messages;
}
