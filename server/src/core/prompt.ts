// 按当前编排状态构造发给各 CLI 的 prompt:注入房间主题、人设、聊天历史、项目上下文。
// v2 变更:删 buildBatonFallbackPrompt(接棒回问兜底已砍——没写接棒行 = 停止,用户接管)。

import type { ChatMessage, MemberConfig, RoomConfig, ToolPermission } from './types';
import { collectProjectContext } from './projectContext';

/** 聊天历史 → 文本转录(带发言者名、受众区分与高权重 Markdown 格式)。recent 限制条数以控制 token。 */
export function historyText(
  messages: ChatMessage[],
  recent = 40,
  viewerId?: string,
  viewerName?: string,
): string {
  const slice = messages.slice(-recent);
  return slice
    .map((m) => {
      // 1. 私聊密信处理
      if (m.audience && m.audience.length > 0) {
        if (viewerId && m.from === viewerId) {
          return `> 🔒 **【私聊密信 ── 你 发送给对方】：**\n> ${m.text}`;
        }
        if (viewerId && m.audience.includes(viewerId)) {
          return `> 🔒 **【私聊密信 ── ${m.fromName} 对 你 悄悄说】：**\n> ${m.text}`;
        }
        return `> 🔒 **【私聊密信 ── 来自 ${m.fromName}】：**\n> ${m.text}`;
      }

      // 2. 全员公聊处理 (检测是否 @提及了当前成员)
      const isMentioned =
        (viewerName && m.text.includes(`@${viewerName}`)) ||
        (viewerId && m.text.includes(`@${viewerId}`));

      if (isMentioned) {
        return `**🎯【@提及了你】[${m.fromName}] (全员公聊)：**\n${m.text}`;
      }
      return `**[${m.fromName}] (全员公聊)：**\n${m.text}`;
    })
    .join('\n\n');
}

/** 发言长度风格 → prompt 指令 */
export function lengthBrief(style: RoomConfig['speechLength']): string {
  switch (style) {
    case 'long':
      return '发言长度不限,把论证、证据、推理过程充分展开,像给同事写一份严肃的技术论述。';
    case 'normal':
      return '发言控制在 600 字以内,论证完整、有理有据,不空泛。';
    case 'short':
    default:
      return '发言控制在 300 字以内,观点鲜明。如果你不认同某人的说法,直接指出并说明理由。';
  }
}

/** 工具权限档位 → 各成员 prompt 里的能力说明(与适配器的 CLI 参数映射对应) */
export function permissionBrief(p: ToolPermission | undefined): string {
  switch (p) {
    case 'readwrite':
      return '你可以使用 Read / Grep / Glob 工具阅读项目,也可以用 Edit / Write 修改项目文件(谨慎,仅在讨论确有必要时)。';
    case 'full':
      return '你可以使用全部工具(读写项目文件、执行命令)围绕项目工作。';
    case 'readonly':
    default:
      return '你可以使用 Read / Grep / Glob 工具阅读和搜索项目文件,但不能修改任何文件。';
  }
}

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

export { parseBaton };

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

  // 1. 精炼身份锚点 (Identity Anchor, 防长程人设漂移)
  parts.push(`你是 **【${member.name}】**。请始终保持你的 **既有人设与核心立场**。`);

  // 2. 自上次发言以来的新增动态
  if (deltaMessages.length > 0) {
    parts.push(`# 自你上次发言以来的最新未读动态:\n\n${historyText(deltaMessages, 40, member.id, member.name)}`);
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

/**
 * 成员名匹配:精确匹配绝对优先;包含匹配仅作模糊后备,且取"最长命中"
 * (防前缀名误匹配:@工程师3 不能命中排在成员表前面的"工程师"——
 *  v1 实测事故:工程师2 传棒@工程师3,find 顺序命中 1 号"工程师",1 号抢答)。
 */
export function matchMemberByName<T extends { id: string; name: string }>(
  rawName: string,
  members: T[],
): T | undefined {
  const trimmed = rawName.trim();
  if (!trimmed) return undefined;

  // 1) 精确相等 (最高优先级)
  const exact = members.find((mm) => mm.name === trimmed);
  if (exact) return exact;

  // 2) 数字/中文序号后缀纠偏:如 @吕布1，若不存在名为"吕布1"的成员，但存在"吕布"，则纠偏匹配"吕布"
  const numSuffixMatch = trimmed.match(/^(.+?)[1一]$/);
  if (numSuffixMatch) {
    const baseName = numSuffixMatch[1]!;
    const baseExact = members.find((mm) => mm.name === baseName);
    if (baseExact) return baseExact;
  }

  // 3) 称呼扩展包含:如输入了"吕布将军"包含"吕布" (trimmed.includes(mm.name))
  const contained = members
    .filter((mm) => trimmed.includes(mm.name))
    .sort((a, b) => b.name.length - a.name.length);
  if (contained[0]) return contained[0];

  // 4) 成员名包含输入，但排除数字序号后缀区分(如输入"吕布"，绝不能模糊匹配到"吕布2"或"吕布3")
  const prefixMatched = members
    .filter((mm) => {
      if (!mm.name.includes(trimmed)) return false;
      // 若 mm.name 去除 trimmed 之后仅剩数字编号，说明是不同角色，不能当作别名命中
      const remainder = mm.name.replace(trimmed, '');
      if (/^[0-9一二三四五六七八九十]+$/.test(remainder)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.name.length - a.name.length);
  return prefixMatched[0];
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
