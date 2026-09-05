// 订阅模式: 私聊受众解析与历史消息投影纯函数。

import type { ChatMessage, MemberConfig } from '../../types';
import { matchMemberByName } from '../../prompt';

/** 私聊行正则: 匹配末尾 `<私聊>@A @B` 或 `【私聊】@A @B` */
export const AUDIENCE_LINE = /(?:<私聊>|【私聊】)\s*(.+)/;

export interface SplitMessageResult {
  /** 公开发言文本 (全员可见)，若无公开发言则为 undefined */
  publicText?: string;
  /** 私聊目标成员 ID 列表 (单人为 [id]，多播为 [id1, id2]) */
  targetMemberIds?: string[];
  /** 私聊正文 (仅目标受众可见)，若无私聊则为 undefined */
  privateText?: string;
  /** 握手态度: agree / reject / idea */
  handshake?: 'agree' | 'reject' | 'idea';
}

/**
 * 智能拆分公开发言与私聊发言(双气泡解构)。
 * 严格杜绝自言自语私聊(自动排除 senderId)。
 * 支持同时私聊多人(例如 <私聊>@A @B 私信内容)。
 * 彻底剥离正文末尾残留的握手标签(<同意>、<拒绝>、<想法>)，并在元数据中返回握手态度。
 */
export function splitPublicAndPrivateMessage(
  rawText: string,
  members: Array<{ id: string; name: string }>,
  senderId?: string,
): SplitMessageResult {
  const otherMembers = senderId ? members.filter((m) => m.id !== senderId) : members;

  // 匹配私聊引导符起始位置
  const privateTagMatch = rawText.match(/(?:<私聊>|【私聊】)/);
  if (!privateTagMatch || privateTagMatch.index === undefined) {
    // 无私聊标签，纯公聊
    return { publicText: rawText.trim() || undefined };
  }

  const tagIndex = privateTagMatch.index;
  const beforeText = rawText.slice(0, tagIndex).trim();
  const afterTag = rawText.slice(tagIndex + privateTagMatch[0].length).trimStart();

  // 从 afterTag 循环提取一个或多个 @目标，剩余内容为私聊正文
  const targetMembers: Array<{ id: string; name: string }> = [];
  let remaining = afterTag;

  for (;;) {
    const m = remaining.match(/^\s*@([^\s@,，。:：\n]+)/);
    if (!m) break;
    const name = m[1]!;
    const hit = matchMemberByName(name, otherMembers);
    if (hit && !targetMembers.some((t) => t.id === hit.id)) {
      targetMembers.push(hit);
    }
    remaining = remaining.slice(m[0].length);
  }

  // 容错：如果开头没有带 @，但直接写了单个名字
  if (targetMembers.length === 0) {
    const singleMatch = afterTag.match(/^([^\s@,，。:：\n]+)([\s\S]*)$/);
    if (singleMatch) {
      const hit = matchMemberByName(singleMatch[1]!, otherMembers);
      if (hit) {
        targetMembers.push(hit);
        remaining = singleMatch[2] ?? '';
      }
    }
  }

  // 若无法匹配任何有效目标(如写了自己的名字或不存在的名字)，降级为纯公聊
  if (targetMembers.length === 0) {
    return { publicText: stripAudienceLine(rawText) || rawText.trim() };
  }

  const targetIds = targetMembers.map((t) => t.id);
  const privateBody = remaining.trim();

  // 提取握手标签态度 (优先显式标签，无标签时智能语义推断兜底)
  let handshake: 'agree' | 'reject' | 'idea' | undefined;
  const handshakeMatch = rawText.match(/<(同意|拒绝|想法)>/);
  if (handshakeMatch) {
    const hs = handshakeMatch[1];
    if (hs === '同意') handshake = 'agree';
    else if (hs === '拒绝') handshake = 'reject';
    else if (hs === '想法') handshake = 'idea';
  } else {
    handshake = inferHandshakeFromText(privateBody || beforeText);
  }

  // 判定模式:
  // 1. 如果私聊标签在最开头(beforeText 为空): 全文为私聊
  if (!beforeText) {
    const cleanOnlyPrivate = privateBody
      .replace(/<(?:同意|拒绝|想法)>[^\n]*/g, '')
      .replace(/^\s*(?:私聊(?:部分)?|悄悄话|密谋)[:：\s]*/g, '')
      .trim();
    return {
      privateText: cleanOnlyPrivate || undefined,
      targetMemberIds: targetIds,
      handshake,
    };
  }

  // 2. 如果 afterTag 只有 @名字，没有后续正文(privateBody 为空):
  // 说明模型将前面的 beforeText 当作了私聊正文发给对方
  if (!privateBody) {
    const cleanBefore = beforeText
      .replace(/<(?:同意|拒绝|想法)>[^\n]*/g, '')
      .replace(/^\s*(?:私聊(?:部分)?|悄悄话|密谋)[:：\s]*/g, '')
      .trim();
    return {
      privateText: cleanBefore,
      targetMemberIds: targetIds,
      handshake,
    };
  }

  // 3. 既有 beforeText 又有 privateBody:
  // 公私双重发言！清洗掉前缀与握手标签并拆分成公聊和私聊双气泡
  const cleanPublic = beforeText
    .replace(/^\s*(?:公开发言(?:部分)?|公开回复|台前发言)[:：\s]*/g, '')
    .trim();
  const cleanPrivate = privateBody
    .replace(/<(?:同意|拒绝|想法)>[^\n]*/g, '')
    .replace(/^\s*(?:私聊(?:部分)?|悄悄话|密谋)[:：\s]*/g, '')
    .trim();

  return {
    publicText: cleanPublic.length > 0 ? cleanPublic : undefined,
    privateText: cleanPrivate.length > 0 ? cleanPrivate : undefined,
    targetMemberIds: targetIds,
    handshake,
  };
}

/**
 * 从文本末尾提取私聊受众目标成员 ID 列表。
 * @param text 完整消息文本
 * @param members 房间内所有成员候选
 * @param senderId 发送者 ID(严格排除自己)
 * @returns 匹配到的目标 memberId 数组; 若没有私聊标记则返回 undefined(表示公聊)
 */
export function parseAudience(
  text: string,
  members: Array<{ id: string; name: string }>,
  senderId?: string,
): string[] | undefined {
  const otherMembers = senderId ? members.filter((m) => m.id !== senderId) : members;
  const tailLines = text.trim().split('\n').slice(-3);
  for (const line of tailLines.reverse()) {
    const m = line.match(AUDIENCE_LINE);
    if (!m) continue;
    const directive = (m[1] ?? '').trim();
    // 匹配所有 @ 的名字
    const atNames = [...directive.matchAll(/@([^\s@,，。]+)/g)].map((mm) => mm[1]!);
    if (atNames.length === 0) {
      // 容错: 如果直接写了名字没带 @，也尝试整段匹配
      const hit = matchMemberByName(directive, otherMembers);
      return hit ? [hit.id] : undefined;
    }
    const audienceIds = new Set<string>();
    for (const name of atNames) {
      const hit = matchMemberByName(name, otherMembers);
      if (hit) audienceIds.add(hit.id);
    }
    return audienceIds.size > 0 ? Array.from(audienceIds) : undefined;
  }
  return undefined;
}

/**
 * 智能语义兜底推断: 当大模型在私聊中未附带尖括号标签时，根据语气关键词推断意图
 */
export function inferHandshakeFromText(text: string): 'agree' | 'reject' | 'idea' | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  // 1. 同意/达成结盟倾向
  if (
    /^(?:(?:好|可以|行|成|没问题|成交|一言为定|依你|就依你|听你的|赞同|认同|同意|接受|按你说的办|依你说的办)[\s，。！!：:]*|.*(?:一言为定|达成同盟|结盟已成|此约已定|此约便定))/i.test(trimmed)
  ) {
    return 'agree';
  }
  // 2. 拒绝倾向
  if (
    /^(?:(?:不行|拒绝|休想|不妥|免谈|绝不|恕难从命|我不同意|不答应)[\s，。！!：:]*|.*(?:绝无可能|绝不同意|绝不答应|断难从命))/i.test(trimmed)
  ) {
    return 'reject';
  }
  // 3. 提出想法/反议价/补充条件倾向
  if (
    /^(?:(?:不过|但|我有不同想法|我的条件是|不如这样|另有一言)[\s，。！!：:]*)/i.test(trimmed)
  ) {
    return 'idea';
  }
  return undefined;
}

export type HandshakeType = 'agree' | 'reject' | 'idea';

export interface HandshakeDirective {
  type: HandshakeType;
  /** 仅当 type === 'idea' 且指定了 @名字 时存在 */
  targetMemberId?: string;
}

/** 匹配握手标签: <同意>、<拒绝>、<想法> @名字 */
export const HANDSHAKE_LINE = /<(同意|拒绝|想法)>\s*(.*)/;

/**
 * 解析发言末尾的私聊握手标签:
 * - <同意>: 终结私聊
 * - <拒绝>: 终结私聊
 * - <想法> @发起方: 推进私聊
 */
export function parseHandshake(
  text: string,
  members: Array<{ id: string; name: string }>,
): HandshakeDirective | undefined {
  const tailLines = text.trim().split('\n').slice(-3);
  for (const line of tailLines.reverse()) {
    const m = line.match(HANDSHAKE_LINE);
    if (!m) continue;
    const rawType = m[1];
    let type: HandshakeType = 'agree';
    if (rawType === '拒绝') type = 'reject';
    else if (rawType === '想法') type = 'idea';

    let targetMemberId: string | undefined;
    if (type === 'idea') {
      const targetStr = (m[2] ?? '').trim();
      const atMatch = targetStr.match(/@([^\s@,，。]+)/);
      const name = atMatch ? atMatch[1] : targetStr;
      if (name) {
        const hit = matchMemberByName(name, members);
        if (hit) targetMemberId = hit.id;
      }
    }
    return { type, targetMemberId };
  }
  return undefined;
}

/**
 * 剥除发言文本中的私聊行与握手行
 */
export function stripAudienceLine(text: string): string {
  return text
    .replace(/(?:<私聊>|【私聊】)[^\n]*/g, '')
    .replace(/<(?:同意|拒绝|想法)>[^\n]*/g, '')
    .trimEnd();
}

/**
 * 根据当前查看者(某 Agent 成员或全局视图)过滤聊天历史。
 * 注入 Prompt 时按此过滤，确保私聊严格受众可见。
 *
 * @param messages 完整聊天记录
 * @param viewerMemberId 当前被注入 Prompt 的成员 ID(为 undefined 时表示管理员/房间主人视角)
 */
export function filterHistoryForViewer(
  messages: ChatMessage[],
  viewerMemberId?: string,
): ChatMessage[] {
  if (!viewerMemberId) return messages; // 无具体成员视角(如全览)保留全量

  return messages.filter((m) => {
    // 1. 无受众限制(公聊全员可见)
    if (!m.audience || m.audience.length === 0) return true;
    // 2. 系统消息、管理员消息全员可见
    if (m.system || m.from === 'system' || m.from === 'scout') return true;
    // 3. 用户发言若带有 audience，仅目标受众可见
    // 4. 发送者本人必定可见
    if (m.from === viewerMemberId) return true;
    // 5. 当前成员在受众名单中可见
    return m.audience.includes(viewerMemberId);
  });
}
