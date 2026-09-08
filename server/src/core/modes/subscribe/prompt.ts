// 订阅模式: 增量消息视窗与自决 Prompt 组装。
// i18n:文案走 promptTexts 词典;标签经 protocolKeywords 的 *For(lang) 注入参数。

import type { ChatMessage, DiscussionSummary, MemberConfig, RoomConfig } from '../../types';
import { historyText } from '../../render';
import { filterHistoryForViewer } from './audience';
import { isPublicSummaryUsable, isDigestUsable } from '../../summaryOps';
import type { PrivateThread } from './protocol';
import type { Lang } from '../../i18n/lang';
import { pt } from '../../i18n/promptTexts';
import {
  batonTagFor, dmTagFor, handshakeTagFor, isSilentText,
} from '../../../protocolKeywords';

/**
 * 组装心跳唤醒时的一步全价自决 Prompt。
 * fullHistory: 房间全量历史(用于校验摘要/纪要锚点是否因截断/清空失效;缺省跳过校验)
 */
export function buildHeartbeatPrompt(
  room: RoomConfig,
  member: MemberConfig,
  deltaMessages: readonly ChatMessage[],
  activeThread?: PrivateThread,
  otherMemberName?: string,
  summary?: DiscussionSummary | null,
  fullHistory?: readonly ChatMessage[],
  lang: Lang = 'zh',
): string {
  // 锚点失效校验:摘要锚点不在历史 → 整份不注入(含纪要);
  // 摘要有效但本人纪要锚点失效 → 仅剔除该成员纪要段
  let usableSummary = summary;
  if (summary && fullHistory) {
    if (!isPublicSummaryUsable(summary, fullHistory)) {
      usableSummary = null;
    } else {
      const d = summary.privateDigests?.[member.id];
      if (d && !isDigestUsable(d, fullHistory)) {
        const digests = { ...summary.privateDigests };
        delete digests[member.id];
        usableSummary = { ...summary, privateDigests: digests };
      }
    }
  }

  // 若摘要锚点存在，剔除 delta 中已被锚点覆盖的消息
  let effectiveDelta = deltaMessages;
  if (usableSummary?.coveredMessageId) {
    const covIdx = deltaMessages.findIndex((m) => m.id === usableSummary.coveredMessageId);
    if (covIdx !== -1) {
      effectiveDelta = deltaMessages.slice(covIdx + 1);
    }
  }

  // 只看针对当前成员可见的增量消息
  const visibleDelta = filterHistoryForViewer(effectiveDelta, member.id);
  const snippet = historyText(visibleDelta, 10, member.id, member.name, lang);

  const candidateNames = room.members.filter((m) => m.id !== member.id).map((m) => m.name);
  // whitelist JSON 的 key 按语言(zh 保持现状字段名)
  const whitelistJson = JSON.stringify(
    lang === 'en' ? { colleagues: candidateNames } : { 可互动同事白名单: candidateNames },
    null, 2,
  );

  const sections: string[] = [
    pt(lang, 'h.identity', { name: member.name, persona: member.persona }),
    ``,
    pt(lang, 'h.whitelistHeader'),
    "```json\n" + whitelistJson + "\n```",
    ``,
    pt(lang, 'h.topic', { topic: room.topic }),
  ];

  // 注入公聊长程摘要与私聊纪要
  if (usableSummary?.text?.trim()) {
    sections.push(``, pt(lang, 'h.summaryLabel'), usableSummary.text.trim());
  }
  const memberDigest = usableSummary?.privateDigests?.[member.id];
  if (memberDigest?.text?.trim()) {
    sections.push(``, pt(lang, 'h.digestLabel'), memberDigest.text.trim());
  }

  sections.push(
    ``,
    pt(lang, 'h.unreadHeader'),
    snippet || pt(lang, 'h.noNewMsg'),
    ``,
    pt(lang, 'h.twoPhase', {
      silentTag: lang === 'en' ? '<skip>' : '<跳过>',
      dmTag: dmTagFor(lang),
    }),
  );


  if (activeThread && activeThread.status === 'active' && otherMemberName) {
    sections.push(
      ``,
      pt(lang, 'h.dmChannel', {
        name: otherMemberName,
        count: activeThread.count,
        agreeTag: handshakeTagFor('agree', lang),
        rejectTag: handshakeTagFor('reject', lang),
        ideaTag: handshakeTagFor('idea', lang),
      }),
    );
  }

  sections.push(
    ``,
    pt(lang, 'h.noBatonRule', {
      batonTag: batonTagFor(lang),
      silentTag: lang === 'en' ? '<skip>' : '<跳过>',
    }),
  );

  return sections.join('\n');
}


/**
 * 检查输出是否为跳过或沉默指令(真源:protocolKeywords.isSilentText,中英并集)
 */
export function isSilentDecision(rawText: string | undefined): boolean {
  return isSilentText(rawText);
}

/**
 * 组装订阅模式下的通用 Prompt 说明段落。
 * @param opts.mustRespond 点名/起头等强制回应条目——禁跳过:两阶段自决段整体替换为
 *        "被直接点名必须回应"(跳过出口只属于心跳自主决策路径)
 */
export function buildSubscribePromptSection(
  member: MemberConfig,
  members: MemberConfig[],
  opts: { mustRespond?: boolean } = {},
  lang: Lang = 'zh',
): string {
  const candidateNames = members.filter((m) => m.id !== member.id).map((m) => m.name);
  const whitelistJson = JSON.stringify(
    lang === 'en' ? { colleagues: candidateNames } : { 可互动同事白名单: candidateNames },
    null, 2,
  );

  if (opts.mustRespond) {
    return pt(lang, 'sb.mustRespond', {
      whitelist: whitelistJson,
      silentTag: lang === 'en' ? '<skip>' : '<跳过>',
      silentTag2: lang === 'en' ? '<silent>' : '<沉默>',
      dmTag: dmTagFor(lang),
      batonTag: batonTagFor(lang),
    });
  }

  return pt(lang, 'sb.auto', {
    whitelist: whitelistJson,
    silentTag: lang === 'en' ? '<skip>' : '<跳过>',
    dmTag: dmTagFor(lang),
    batonTag: batonTagFor(lang),
  });
}
