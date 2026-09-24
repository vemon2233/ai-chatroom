// 按当前编排状态构造发给各 CLI 的 prompt:注入房间主题、人设、聊天历史、项目上下文。
// v2 变更:删 buildBatonFallbackPrompt(接棒回问兜底已砍——没写接棒行 = 停止,用户接管)。
// 渲染叶子(historyText/lengthBrief/permissionBrief)在 render.ts;名字匹配叶子在 naming.ts。

import type { ChatMessage, MemberConfig, RoomConfig } from './types';
import { collectProjectContext } from './projectContext';
import { historyText, lengthBrief, permissionBrief } from './render';

import { buildBatonPromptSection } from './modes/baton/prompt';
import { parseBaton } from './modes/baton/baton';
import { filterHistoryForViewer } from './modes/subscribe/audience';
import { buildSubscribePromptSection } from './modes/subscribe/prompt';
import type { Lang } from './i18n/lang';
import { pt } from './i18n/promptTexts';

import {
  isPublicSummaryUsable,
  isDigestUsable,
  buildInjectionWindow,
} from './summaryOps';
import type { DiscussionSummary } from './types';

/** 构造一次成员发言的完整 prompt。 */
export async function buildPrompt(
  room: RoomConfig,
  member: MemberConfig,
  history: readonly ChatMessage[],
  opts: {
    trigger?: string;
    instruction?: string;
    batonMode?: 'chain' | 'callout';
    summary?: DiscussionSummary | string | null;
    /** 订阅模式:点名/起头等强制回应条目——禁跳过(两阶段自决段替换为点名必答) */
    mustRespond?: boolean;
    /** prompt 语言(缺省 zh——与改造前逐字节一致) */
    lang?: Lang;
  } = {},
): Promise<string> {
  const lang = opts.lang ?? 'zh';
  const others = room.members
    .filter((m) => m.id !== member.id)
    .map((m) => `- ${m.name}`)
    .join('\n');

  const parts: string[] = [];

  parts.push(pt(lang, 'p.roleHeader', { name: member.name, persona: member.persona }));

  parts.push(pt(lang, 'p.roomHeader', { name: room.name, topic: room.topic || pt(lang, 'p.topicFallback') }));

  // 参与者列表/房主段:任务房不注入(单成员为主,协作走 @ 点名;工单04 契约)
  const isTask = room.kind === 'task';
  if (others && !isTask) {
    parts.push(pt(lang, 'p.othersHeader', { list: others }));
  }

  if (!isTask && room.userPersona && room.userPersona.persona?.trim()) {
    parts.push(pt(lang, 'p.ownerSection', { name: room.userPersona.name, persona: room.userPersona.persona.trim() }));
  }

  // 项目上下文:任务房 = 任务工作区段(真实权限说明+范围约定+自主探索,不注入目录树——
  // agent 用工具查实时结构;scout 报告在任务房永不产生,runScout 已短路);
  // 聊天房 = 原状(目录树+讨论教学或 scout 报告)
  if (room.projectPath) {
    if (isTask) {
      parts.push(pt(lang, 't.workspace', {
        root: room.projectPath,
        perm: permissionBrief(room.toolPermission, lang),
      }));
    } else {
      const scoutReport = history.find(
        (m) => m.from === 'scout' && typeof m.text === 'string',
      );
      if (scoutReport) {
        parts.push(pt(lang, 'p.projectScoutSection', { root: room.projectPath, report: scoutReport.text }));
      } else {
        const ctx = await collectProjectContext(room.projectPath);
        parts.push(pt(lang, 'p.projectFreshSection', {
          root: ctx.root,
          tree: ctx.tree,
          perm: permissionBrief(room.toolPermission, lang),
        }));
      }
    }
  }

  // 聊天记录与前置摘要注入: 结合上下文压缩层锚点视窗与受众可见性过滤
  const summaryObj = typeof opts.summary === 'object' ? opts.summary : null;
  const summaryStr = typeof opts.summary === 'string' ? opts.summary : null;

  const publicSummaryText = summaryObj
    ? (isPublicSummaryUsable(summaryObj, history) ? summaryObj.text?.trim() : '')
    : (summaryStr ? summaryStr.trim() : '');

  const memberDigest = summaryObj?.privateDigests?.[member.id];
  const privateDigestText = (memberDigest && isDigestUsable(memberDigest, history))
    ? memberDigest.text?.trim()
    : '';

  const injectionWindow = buildInjectionWindow(history, member.id, summaryObj);

  if (publicSummaryText || privateDigestText || injectionWindow.length > 0) {
    const historySections: string[] = [];
    if (publicSummaryText) {
      historySections.push(`${pt(lang, 'p.publicSummaryLabel')}\n${publicSummaryText}`);
    }
    if (privateDigestText) {
      historySections.push(`${pt(lang, 'p.privateDigestLabel')}\n${privateDigestText}`);
    }
    if (injectionWindow.length > 0) {
      historySections.push(`${pt(lang, 'p.recentHistoryLabel')}\n${historyText(injectionWindow, 40, member.id, member.name, lang)}`);
    }
    parts.push(`${pt(lang, 'p.historySectionHeader')}\n${historySections.join('\n\n')}`);
  }


  const instructions: string[] = [];
  if (opts.trigger) instructions.push(opts.trigger);
  if (opts.instruction) instructions.push(opts.instruction);
  if (isTask) {
    // 任务房:任务行动契约替换讨论指令(无"角色发言"框架、无长度约束)
    instructions.push(pt(lang, 't.contract'));
  } else {
    instructions.push(
      pt(lang, 'p.speakDirectly'),
      lengthBrief(room.speechLength, lang),
    );
  }

  // 模式规则段落: 订阅模式 vs 接棒模式(任务房恒 baton 且不教接棒——
  // 多成员协作由用户手动 @ 驱动,成员干完即停;ADR-0001)
  if (!isTask) {
    if (room.mode === 'subscribe') {
      parts.push(buildSubscribePromptSection(member, room.members, { mustRespond: opts.mustRespond }, lang));
    } else if (opts.batonMode === 'chain' || opts.batonMode === 'callout') {
      parts.push(buildBatonPromptSection(member, room.members, opts.batonMode, lang));
    }
  }

  parts.push(pt(lang, 'p.nowTurn', { instructions: instructions.join('\n') }));

  return parts.join('\n\n---\n\n');
}

/**
 * 从消息列表中切出自指定位点之后的新增消息(增量消息)。
 * 若 lastSeenId 为空或未命中（如截断或清空重置），则判定为需要重新锚定。
 */
export function extractDeltaMessages(
  allMessages: ChatMessage[],
  lastSeenId?: string,
): { delta: ChatMessage[]; isReanchored: boolean } {
  if (!lastSeenId) {
    return { delta: allMessages, isReanchored: true };
  }
  const idx = allMessages.findIndex((m) => m.id === lastSeenId);
  if (idx === -1) {
    // 历史被截断或消息被清空，旧游标失效，需全量重新锚定
    return { delta: allMessages, isReanchored: true };
  }
  return { delta: allMessages.slice(idx + 1), isReanchored: false };
}

/**
 * 构造有状态增量模式下的极简 Prompt (Delta Prompt)。
 * 彻底剔除静态背景设定，仅提供身份锚点、自上次发言以来的新增对话、以及精炼行动指引。
 */
export function buildDeltaPrompt(
  room: RoomConfig,
  member: MemberConfig,
  deltaMessages: ChatMessage[],
  opts: {
    trigger?: string;
    instruction?: string;
    batonMode?: 'chain' | 'callout';
    /** 订阅模式:强制回应条目——禁跳过 */
    mustRespond?: boolean;
    /** 3 档用户规则常驻注入(增量游标越过后的豁免;调用方组装,不含 delta 内已有条目) */
    pinnedRules?: readonly ChatMessage[];
    /** prompt 语言(缺省 zh——与改造前逐字节一致) */
    lang?: Lang;
  } = {},
): string {
  const lang = opts.lang ?? 'zh';
  const parts: string[] = [];

  // 0. 受众可见性过滤(与全量路径 buildInjectionWindow / 心跳路径 buildHeartbeatPrompt 同范式):
  // 增量切片绝不含第三方私聊原文——防 stateful 房间泄漏 A↔B 密谋给 C。
  const visibleDelta = filterHistoryForViewer(deltaMessages, member.id);

  // 1. 精炼身份锚点 (Identity Anchor, 防长程人设漂移)
  parts.push(pt(lang, 'd.identityAnchor', { name: member.name }));

  // 1.5 用户既定规则段(增量游标越过即丢 → 调用方 pin 回,独立段呈现语义更准)
  if (opts.pinnedRules && opts.pinnedRules.length > 0) {
    parts.push(pt(lang, 'd.pinnedRules', {
      rules: opts.pinnedRules
        .map((m) => pt(lang, 'r.userRule', { name: m.fromName, text: m.text }))
        .join('\n\n'),
    }));
  }

  // 2. 自上次发言以来的新增动态
  if (visibleDelta.length > 0) {
    parts.push(`${pt(lang, 'd.unreadHeader')}\n\n${historyText(visibleDelta, 40, member.id, member.name, lang)}`);
  } else {
    parts.push(pt(lang, 'd.noNewMsg'));
  }

  // 3. 极简行动指引 (按模式适配;任务房=任务契约,无接棒教学无长度约束)
  if (room.kind === 'task') {
    parts.push(pt(lang, 't.contract'));
  } else if (room.mode === 'subscribe') {
    parts.push(buildSubscribePromptSection(member, room.members, { mustRespond: opts.mustRespond }, lang));
  } else {
    const brief = lengthBrief(room.speechLength, lang);
    const batonSec =
      opts.batonMode === 'chain' || opts.batonMode === 'callout'
        ? buildBatonPromptSection(member, room.members, opts.batonMode, lang)
        : '';
    parts.push([`${pt(lang, 'd.taskHeader', { brief })}`, batonSec].filter(Boolean).join('\n'));
  }

  if (opts.instruction) {
    parts.push(pt(lang, 'd.extraInstruction', { text: opts.instruction }));
  }

  return parts.join('\n\n---\n\n');
}

/** 侦察员 prompt:haiku 档、只读工具,产出结构化分析报告供全员共享。 */
export function buildScoutPrompt(projectRoot: string, tree: string, lang: Lang = 'zh'): string {
  return pt(lang, 's.scoutPrompt', { root: projectRoot, tree });
}
