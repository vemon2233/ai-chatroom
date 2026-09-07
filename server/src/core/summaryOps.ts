// 上下文压缩层: 纯函数计算工具集 (锚点切分、可用性判定、未覆盖计数与注入视窗组装)

import type { ChatMessage, DiscussionSummary, MemberConfig, PrivateDigest } from './types';
import { filterHistoryForViewer } from './modes/subscribe/audience';
import { oneShotSpeak } from './exec';
import type { AgentAdapter, SpeakRequest } from '../adapters/base';


/**
 * 过滤有效公聊消息: 非系统、非空文本、无受众(不含私聊)
 */
export function filterValidPublic(history: readonly ChatMessage[]): ChatMessage[] {
  return history.filter(
    (m) => !m.system && m.text.trim().length > 0 && (!m.audience || m.audience.length === 0),
  );
}

/**
 * 按锚点切分消息历史; 若锚点缺失或已不在历史中(如被截断/清空), 返回 anchorValid=false, after=全部历史
 */
export function splitHistoryByAnchor(
  history: readonly ChatMessage[],
  anchorId?: string,
): { anchorValid: boolean; after: ChatMessage[] } {
  if (!anchorId) {
    return { anchorValid: false, after: [...history] };
  }
  const idx = history.findIndex((m) => m.id === anchorId);
  if (idx === -1) {
    return { anchorValid: false, after: [...history] };
  }
  return { anchorValid: true, after: history.slice(idx + 1) };
}

/**
 * 判定公聊摘要是否可注入:
 * - 存在有效文本
 * - 无锚点字段(旧存量数据): 降级为 true 照常注入
 * - 有锚点字段但该 ID 不在当前历史中: 返回 false (视为失效, 避免注入已被删除的幽灵记忆)
 */
export function isPublicSummaryUsable(
  summary: DiscussionSummary | null | undefined,
  history: readonly ChatMessage[],
): boolean {
  if (!summary || !summary.text || !summary.text.trim()) {
    return false;
  }
  if (!summary.coveredMessageId) {
    return true; // 存量数据无锚点字段, 平滑降级
  }
  return history.some((m) => m.id === summary.coveredMessageId);
}

/**
 * 判定成员私聊纪要是否可注入
 */
export function isDigestUsable(
  digest: PrivateDigest | null | undefined,
  history: readonly ChatMessage[],
): boolean {
  if (!digest || !digest.text || !digest.text.trim()) {
    return false;
  }
  if (!digest.coveredMessageId) {
    return true;
  }
  return history.some((m) => m.id === digest.coveredMessageId);
}

/**
 * 计算锚点后未覆盖的公聊条数(供自动触发判定; 锚点无效或缺失时等于全部有效公聊数)
 */
export function countUncoveredPublic(
  history: readonly ChatMessage[],
  summary: DiscussionSummary | null | undefined,
): number {
  const validPublic = filterValidPublic(history);
  if (!summary || !summary.coveredMessageId) {
    return validPublic.length;
  }
  const idx = validPublic.findIndex((m) => m.id === summary.coveredMessageId);
  if (idx === -1) {
    return validPublic.length;
  }
  return validPublic.length - 1 - idx;
}

/**
 * 过滤指定成员可见的有效私聊消息
 */
export function filterMemberPrivateMessages(
  history: readonly ChatMessage[],
  memberId: string,
): ChatMessage[] {
  return history.filter(
    (m) =>
      !m.system &&
      m.text.trim().length > 0 &&
      Array.isArray(m.audience) &&
      m.audience.length > 0 &&
      (m.from === memberId || m.audience.includes(memberId)),
  );
}

/**
 * 计算该成员在纪要锚点后未覆盖的私聊条数(供私聊自总结阈值判定)
 */
export function countUncoveredPrivateFor(
  history: readonly ChatMessage[],
  memberId: string,
  digest?: PrivateDigest | null,
): number {
  return uncoveredPrivateMessages(history, memberId, digest).delta.length;
}

/**
 * 切出该成员纪要锚点后的未覆盖私聊(供纪要生成增量喂入)。
 * 锚点缺失或不在历史(截断/清空导致失效)→ anchorValid=false, delta=全部该成员私聊
 * (调用方据此丢弃旧纪要不链式继承——旧文含已删除信息,公聊侧同语义见 Admin.doGenerateSummary)
 */
export function uncoveredPrivateMessages(
  history: readonly ChatMessage[],
  memberId: string,
  digest?: PrivateDigest | null,
): { anchorValid: boolean; delta: ChatMessage[] } {
  const memberPrivates = filterMemberPrivateMessages(history, memberId);
  if (!digest || !digest.coveredMessageId) {
    return { anchorValid: false, delta: memberPrivates };
  }
  const idx = memberPrivates.findIndex((m) => m.id === digest.coveredMessageId);
  if (idx === -1) {
    return { anchorValid: false, delta: memberPrivates };
  }
  return { anchorValid: true, delta: memberPrivates.slice(idx + 1) };
}

/**
 * 活跃私聊线程判定:
 * threadId 最后一帧消息的握手状态非 agree/reject 即为活跃状态
 */
export function isPrivateThreadActive(
  history: readonly ChatMessage[],
  threadId: string,
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.threadId === threadId) {
      return m.handshake !== 'agree' && m.handshake !== 'reject';
    }
  }
  return false;
}

/**
 * 组装注入视窗(接棒全量与心跳共用):
 * 锚点后公聊 ∪ 锚点后本人可见私聊 ∪ 锚点前活跃线程私聊(豁免截断), 严格保持原有历史时序
 */
export function buildInjectionWindow(
  history: readonly ChatMessage[],
  viewerId: string,
  summary?: DiscussionSummary | null,
): ChatMessage[] {
  const isUsable = isPublicSummaryUsable(summary, history);
  const anchorId = isUsable ? summary?.coveredMessageId : undefined;

  if (!anchorId) {
    return filterHistoryForViewer(history, viewerId);
  }

  const anchorIdx = history.findIndex((m) => m.id === anchorId);
  if (anchorIdx === -1) {
    return filterHistoryForViewer(history, viewerId);
  }

  const result: ChatMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    // 检查该消息是否对当前观察者可见
    const isVisible =
      !m.audience ||
      m.audience.length === 0 ||
      m.from === viewerId ||
      m.audience.includes(viewerId);
    if (!isVisible) continue;

    if (i > anchorIdx) {
      // 锚点后的新鲜消息全部保留
      result.push(m);
    } else {
      // 锚点及之前的历史: 公聊已经被摘要浓缩，仅当是有活跃线程的私聊时豁免保留
      if (m.threadId && isPrivateThreadActive(history, m.threadId)) {
        result.push(m);
      }
    }
  }

  return result;
}


/**
 * 构造成员第一人称私聊自总结 Prompt
 */
export function buildPrivateDigestPrompt(
  member: MemberConfig,
  privateMessages: readonly ChatMessage[],
  prevDigest?: PrivateDigest | null,
): string {
  const formatted = privateMessages
    .map((m) => `[${m.fromName} -> ${(m.audience ?? []).join(',') || '密信'}]: ${m.text}`)
    .join('\n\n');

  const parts: string[] = [
    `你是 **【${member.name}】**。`,
    `你的人设立场如下:\n${member.persona}`,
    `【任务指引】\n请以第一人称视角，梳理并总结你在本房间中的所有私聊密信往来。`,
    `重点包括：你与谁沟通过、核心谈了什么、达成了什么共识或密谋、有哪些未决事项或对他人隐瞒的策略信息。`,
  ];

  if (prevDigest?.text) {
    parts.push(
      `【你此前记录的既有私聊纪要(请在此基础上滚动更新合并)】\n${prevDigest.text}`,
      `【自上次记录以来的新增私聊记录(共 ${privateMessages.length} 条)】\n${formatted}`,
    );
  } else {
    parts.push(
      `【你在本房间中的私聊往来记录(共 ${privateMessages.length} 条)】\n${formatted}`,
    );
  }

  parts.push(
    `【输出要求】`,
    `直接输出你的第一人称私密回忆纪要，内容精炼控制在 500 字以内，不要使用任何开场白或无意义套话。`,
  );

  return parts.join('\n\n');
}

/**
 * 执行单次成员私聊纪要提炼
 */
export async function executePrivateDigest(input: {
  member: MemberConfig;
  privateMessages: readonly ChatMessage[];
  prevDigest?: PrivateDigest | null;
  adapter: AgentAdapter;
  command: string;
  args: string[];
  timeoutMs?: number;
}): Promise<PrivateDigest | null> {
  const { member, privateMessages, prevDigest, adapter, command, args, timeoutMs = 120000 } = input;
  if (privateMessages.length === 0) return null;

  const prompt = buildPrivateDigestPrompt(member, privateMessages, prevDigest);
  const req: SpeakRequest = {
    member: member.id,
    prompt,
    command,
    args,
    permission: 'readonly',
  };

  const outcome = await oneShotSpeak(req, adapter, timeoutMs);
  const text = outcome.result.trim();
  if (outcome.status !== 'ok' || !text) {
    return null;
  }

  const lastMsg = privateMessages[privateMessages.length - 1];
  return {
    text,
    coveredMessageId: lastMsg?.id ?? '',
    updatedAt: Date.now(),
  };
}

/**
 * 执行 Stateful Claude CLI Session 压缩 (/compact)
 */
export async function executeCompactSession(input: {
  member: MemberConfig;
  sessionId: string;
  model: string;
  kind: string;
  adapter: AgentAdapter;
  command: string;
  args: string[];
  timeoutMs?: number;
}): Promise<boolean> {
  const { member, sessionId, model, kind, adapter, command, args, timeoutMs = 120000 } = input;
  // 仅 claude 支持原生 /compact 指令
  if (kind !== 'claude') {
    return false;
  }

  const req: SpeakRequest = {
    member: member.id,
    prompt: '/compact',
    command,
    args: [...args, '--model', model],
    resumeSessionId: sessionId,
    permission: 'readonly',
  };

  const outcome = await oneShotSpeak(req, adapter, timeoutMs);
  return outcome.status === 'ok';
}

