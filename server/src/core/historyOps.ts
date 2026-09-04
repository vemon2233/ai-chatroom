import type { ChatMessage } from './types';

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
