// 订阅模式: 私聊受众解析与历史消息投影纯函数。

import type { ChatMessage, MemberConfig } from '../../types';
import { matchMemberByName } from '../../naming';

/** 私聊行正则: 匹配末尾 `<私聊>@A @B` 或 `【私聊】@A @B` */
export const AUDIENCE_LINE = /(?:<私聊>|【私聊】)\s*(.+)/;

export interface PrivateBlock {
  /** 私聊目标成员 ID 列表 (单人为 [id]，多播为 [id1, id2]) */
  targetMemberIds: string[];
  /** 私聊正文 (仅目标受众可见) */
  privateText: string;
  /** 握手态度: agree / reject / idea */
  handshake?: 'agree' | 'reject' | 'idea';
}

export interface SplitMessageResult {
  /** 公开发言文本 (全员可见)，若无公开发言则为 undefined */
  publicText?: string;
  /** 所有解析出的私聊消息块列表 (支持向不同/相同成员发起多段独立私聊) */
  privateBlocks: PrivateBlock[];
  /** 私聊首位目标成员 ID 列表 (向下兼容快捷字段) */
  targetMemberIds?: string[];
  /** 私聊首段正文 (向下兼容快捷字段) */
  privateText?: string;
  /** 首段握手态度 (向下兼容快捷字段) */
  handshake?: 'agree' | 'reject' | 'idea';
}

/**
 * 智能拆分公开发言与多段私聊发言(多气泡解构)。
 * 严格杜绝自言自语私聊(自动排除 senderId)。
 * 支持同时私聊多人(例如 <私聊>@A @B 私信内容)。
 * 支持单次发言输出多段发给不同同事的独立私聊(<私聊>@A 内容A ... <私聊>@B 内容B)。
 * 彻底剥离正文末尾残留的握手标签(<同意>、<拒绝>、<想法>)，并在元数据中返回握手态度。
 */
export function splitPublicAndPrivateMessage(
  rawText: string,
  members: Array<{ id: string; name: string }>,
  senderId?: string,
): SplitMessageResult {
  const otherMembers = senderId ? members.filter((m) => m.id !== senderId) : members;

  // 1. 查找所有私聊引导符起始位置
  const privateTagRegex = /(?:<私聊>|【私聊】)/g;
  const matches = [...rawText.matchAll(privateTagRegex)];

  if (matches.length === 0) {
    // 无任何私聊标签，纯公聊
    return {
      publicText: rawText.trim() || undefined,
      privateBlocks: [],
    };
  }

  const firstTag = matches[0];
  if (!firstTag || firstTag.index === undefined) {
    return {
      publicText: rawText.trim() || undefined,
      privateBlocks: [],
    };
  }

  // 2. 第一个私聊标签之前的内容为公开发言部分
  const firstTagIndex = firstTag.index;
  const beforeText = rawText.slice(0, firstTagIndex).trim();

  // 3. 按照私聊标签位置将后续内容切分为多个独立的私聊 chunk
  const rawChunks: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const curMatch = matches[i];
    if (!curMatch || curMatch.index === undefined) continue;
    const curStart = curMatch.index + curMatch[0].length;
    const nextMatch = i + 1 < matches.length ? matches[i + 1] : undefined;
    const nextStart = nextMatch && nextMatch.index !== undefined ? nextMatch.index : rawText.length;
    rawChunks.push(rawText.slice(curStart, nextStart));
  }

  const privateBlocks: PrivateBlock[] = [];

  for (const chunk of rawChunks) {
    const trimmedChunk = chunk.trimStart();
    // 循环提取该 chunk 开头的一个或多个 @目标
    const targetMembers: Array<{ id: string; name: string }> = [];
    let remaining = trimmedChunk;

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
      const singleMatch = trimmedChunk.match(/^([^\s@,，。:：\n]+)([\s\S]*)$/);
      if (singleMatch) {
        const hit = matchMemberByName(singleMatch[1]!, otherMembers);
        if (hit) {
          targetMembers.push(hit);
          remaining = singleMatch[2] ?? '';
        }
      }
    }

    // 若无法匹配任何有效目标，跳过本 chunk
    if (targetMembers.length === 0) {
      continue;
    }

    const targetIds = targetMembers.map((t) => t.id);
    let privateBody = remaining.trim();

    // 提取该 chunk 中的握手标签
    let handshake: 'agree' | 'reject' | 'idea' | undefined;
    const handshakeMatch = chunk.match(/<(同意|拒绝|想法)>/);
    if (handshakeMatch) {
      const hs = handshakeMatch[1];
      if (hs === '同意') handshake = 'agree';
      else if (hs === '拒绝') handshake = 'reject';
      else if (hs === '想法') handshake = 'idea';
    } else {
      handshake = inferHandshakeFromText(privateBody);
    }

    // 清洗私聊正文中的握手标签与前缀
    const cleanPrivate = privateBody
      .replace(/<(?:同意|拒绝|想法)>[^\n]*/g, '')
      .replace(/^\s*(?:私聊(?:部分)?|悄悄话|密谋)[:：\s]*/g, '')
      .trim();

    if (cleanPrivate.length > 0) {
      privateBlocks.push({
        targetMemberIds: targetIds,
        privateText: cleanPrivate,
        handshake,
      });
    }
  }

  // 4. 清洗公开发言部分
  let cleanPublic: string | undefined;
  if (beforeText.length > 0) {
    const cleaned = beforeText
      .replace(/^\s*(?:公开发言(?:部分)?|公开回复|台前发言|公聊(?:部分)?)[:：\s]*/g, '')
      .trim();
    if (cleaned.length > 0) {
      cleanPublic = cleaned;
    }
  }

  // 5. 容错：如果既没有公聊，又没有成功解析出任何私聊块，降级为纯公聊
  if (!cleanPublic && privateBlocks.length === 0) {
    cleanPublic = stripAudienceLine(rawText) || rawText.trim();
  }

  // 6. 容错：如果 chunk 正文为空，但 beforeText 不为空 (大模型把正文写在前面，私聊标签放最后)
  if (privateBlocks.length === 0 && matches.length > 0 && beforeText.length > 0) {
    const tailChunk = rawChunks[rawChunks.length - 1];
    const targetMatch = tailChunk?.match(/@?([^\s@,，。:：\n]+)/);
    if (targetMatch) {
      const hit = matchMemberByName(targetMatch[1]!, otherMembers);
      if (hit) {
        const hsMatch = rawText.match(/<(同意|拒绝|想法)>/);
        let hs: 'agree' | 'reject' | 'idea' | undefined;
        if (hsMatch) {
          hs = hsMatch[1] === '同意' ? 'agree' : hsMatch[1] === '拒绝' ? 'reject' : 'idea';
        }
        privateBlocks.push({
          targetMemberIds: [hit.id],
          privateText: beforeText.replace(/<(?:同意|拒绝|想法)>[^\n]*/g, '').trim(),
          handshake: hs,
        });
        cleanPublic = undefined;
      }
    }
  }

  const firstBlock = privateBlocks[0];
  return {
    publicText: cleanPublic,
    privateBlocks,
    targetMemberIds: firstBlock?.targetMemberIds,
    privateText: firstBlock?.privateText,
    handshake: firstBlock?.handshake,
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
  messages: readonly ChatMessage[],
  viewerMemberId?: string,
): ChatMessage[] {
  if (!viewerMemberId) return [...messages]; // 无具体成员视角(如全览)保留全量

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
