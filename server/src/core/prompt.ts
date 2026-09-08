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
  } = {},
): Promise<string> {
  const others = room.members
    .filter((m) => m.id !== member.id)
    .map((m) => `- ${m.name}`)
    .join('\n');

  const parts: string[] = [];

  parts.push(`# 你的角色\n你是 **【${member.name}】**。\n${member.persona}`);

  parts.push(`# 房间:${room.name}\n讨论主题:${room.topic || '自由讨论'}`);

  if (others) {
    parts.push(`# 其他参与者\n${others}`);
  }

  // 项目上下文:目录树 + 工具探索引导;若已有侦察报告则注入报告并阻止重复探索
  if (room.projectPath) {
    const scoutReport = history.find(
      (m) => m.from === 'scout' && typeof m.text === 'string',
    );
    if (scoutReport) {
      parts.push(
        `# 讨论对象:本地项目(侦察报告已有,无需重复探索)\n` +
        `项目根目录:\`${room.projectPath}\`\n\n` +
        `下方是侦察员已完成的项目分析报告,直接基于它讨论即可——\n` +
        `**不要重复用工具浏览项目**,只有报告未覆盖且讨论确需某个具体文件细节时才单独去读。\n\n` +
        `---\n${scoutReport.text}\n---`,
      );
    } else {
      const ctx = await collectProjectContext(room.projectPath);
      parts.push(
        `# 讨论对象:本地项目\n` +
        `本次讨论围绕一个真实项目进行。项目根目录:\`${ctx.root}\`\n\n` +
        `目录结构概览:\n\`\`\`\n${ctx.tree}\n\`\`\`\n\n` +
        `${permissionBrief(room.toolPermission)}\n` +
        `需要深入了解某个文件时,直接用工具去读,不要凭目录名猜测内容。首次发言前建议先浏览关键文件再表态。`,
      );
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
      historySections.push(`【前期讨论摘要】\n${publicSummaryText}`);
    }
    if (privateDigestText) {
      historySections.push(`【你的私聊往来纪要(仅你可见)】\n${privateDigestText}`);
    }
    if (injectionWindow.length > 0) {
      historySections.push(`【近期讨论发言(按时间顺序,最新在后)】\n${historyText(injectionWindow, 40, member.id, member.name)}`);
    }
    parts.push(`# 聊天记录与讨论背景\n${historySections.join('\n\n')}`);
  }


  const instructions: string[] = [];
  if (opts.trigger) instructions.push(opts.trigger);
  if (opts.instruction) instructions.push(opts.instruction);
  instructions.push(
    '请直接以你的角色身份发言。不要复述设定,不要使用 markdown 标题,直接说出你的观点/回应。',
    lengthBrief(room.speechLength),
  );

  // 模式规则段落: 订阅模式 vs 接棒模式
  if (room.mode === 'subscribe') {
    parts.push(buildSubscribePromptSection(member, room.members));
  } else if (opts.batonMode === 'chain' || opts.batonMode === 'callout') {
    parts.push(buildBatonPromptSection(member, room.members, opts.batonMode));
  }

  parts.push(`# 现在轮到你发言\n${instructions.join('\n')}`);

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
  } = {},
): string {
  const parts: string[] = [];

  // 0. 受众可见性过滤(与全量路径 buildInjectionWindow / 心跳路径 buildHeartbeatPrompt 同范式):
  // 增量切片绝不含第三方私聊原文——防 stateful 房间泄漏 A↔B 密谋给 C。
  const visibleDelta = filterHistoryForViewer(deltaMessages, member.id);

  // 1. 精炼身份锚点 (Identity Anchor, 防长程人设漂移)
  parts.push(`你是 **【${member.name}】**。请始终保持你的 **既有人设与核心立场**。`);

  // 2. 自上次发言以来的新增动态
  if (visibleDelta.length > 0) {
    parts.push(`# 自你上次发言以来的最新未读动态:\n\n${historyText(visibleDelta, 40, member.id, member.name)}`);
  } else {
    parts.push(`# 自你上次发言以来暂无新增动态。`);
  }

  // 3. 极简行动指引 (按模式适配)
  if (room.mode === 'subscribe') {
    parts.push(buildSubscribePromptSection(member, room.members));
  } else {
    const brief = lengthBrief(room.speechLength);
    const batonSec =
      opts.batonMode === 'chain' || opts.batonMode === 'callout'
        ? buildBatonPromptSection(member, room.members, opts.batonMode)
        : '';
    parts.push([`# 你的行动任务:\n${brief}`, batonSec].filter(Boolean).join('\n'));
  }

  if (opts.instruction) {
    parts.push(`# 额外指令:\n${opts.instruction}`);
  }

  return parts.join('\n\n---\n\n');
}

/** 侦察员 prompt:haiku 档、只读工具,产出结构化分析报告供全员共享。 */
export function buildScoutPrompt(projectRoot: string, tree: string): string {
  return [
    `你是项目侦察员。快速分析下面的项目并输出一份精炼的《项目侦察报告》,供一组 AI 讨论者直接使用(他们不会再重复读文件)。`,
    ``,
    `报告结构(纯文本,总共 400 字以内):`,
    `1. 项目是什么(一句话)`,
    `2. 技术栈与关键依赖`,
    `3. 目录结构与核心模块(各一行说明)`,
    `4. 数据存储现状(如有:现有数据库/文件存储/无)`,
    `5. 值得讨论者注意的 2-3 个特点/约束`,
    ``,
    `项目根目录:${projectRoot}`,
    `目录概览:`,
    tree,
    ``,
    `你可以使用 Read/Glob/Grep 工具查看必要文件(README、配置、入口代码),但控制在 10 次以内,快速完成。直接输出报告正文,不要客套。`,
  ].join('\n');
}
