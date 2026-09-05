// 订阅模式: 增量消息视窗与自决 Prompt 组装。

import type { ChatMessage, MemberConfig, RoomConfig } from '../../types';
import { historyText } from '../../prompt';
import { filterHistoryForViewer } from './audience';
import type { PrivateThread } from './protocol';

/**
 * 组装心跳唤醒时的一步全价自决 Prompt。
 */
export function buildHeartbeatPrompt(
  room: RoomConfig,
  member: MemberConfig,
  deltaMessages: ChatMessage[],
  activeThread?: PrivateThread,
  otherMemberName?: string,
): string {
  // 只看针对当前成员可见的增量消息
  const visibleDelta = filterHistoryForViewer(deltaMessages, member.id);
  const snippet = historyText(visibleDelta, 10, member.id, member.name);

  const candidateNames = room.members.filter((m) => m.id !== member.id).map((m) => m.name);
  const whitelistJson = JSON.stringify({ 可互动同事白名单: candidateNames }, null, 2);

  const sections: string[] = [
    `# 你的身份`,
    `你是 **【${member.name}】**。`,
    `立场/人设: ${member.persona}`,
    ``,
    `# 可互动同事白名单 (本名单已排除你自己;**严禁给自己发私聊**;**严禁脑补数字后缀如 @名字1**)`,
    `\`\`\`json\n${whitelistJson}\n\`\`\``,
    ``,
    `# 讨论主题: ${room.topic}`,
    ``,
    `# 自上次查看以来的最新未读消息`,
    snippet || '(自上次查看以来暂无新消息)',
    ``,
    `# 你的行动决策 (两阶段自决法则)`,
    `阅读上述最新讨论，你有完全的自主决定权。请务必按以下两阶段推进你的思考：`,
    ``,
    `【第一阶段：意向自评 (先评估意图，再构思内容)】`,
    `请在心中自评两件事：`,
    `1. **公聊意愿 (0 ~ 100 分)**：你此时在大群公开发言的迫切度。`,
    `   - < 60分：观点刚才已表达清楚、或话题与你关系不大、或想先看别人怎么吵、保持沉默更有利。`,
    `   - ≥ 60分：被他人直接质问、面临重大危机、或有不可不发的新立场/新反驳必须公开宣布。`,
    `2. **私聊意向 (有 / 无)**：审视上方同事白名单，你此刻是否想私下给某人单独通个气、对个暗号、商量对策、提醒兄弟、或暗中结盟？`,
    `   - 若有，明确私聊对象是谁，核心想私下沟通什么 (支持单人如 @名字，也支持同时找多个人如 @名字A @名字B)。`,
    ``,
    `【第二阶段：按自评结果执行输出】`,
    `- 若【公聊意愿 < 60 且 无私聊意向】：**严格直接输出 <跳过>** (保持潜水观望局势，绝不多言)。`,
    `- 若【公聊意愿 ≥ 60 且 无私聊意向】：**直接输出公开发言正文** (纯公聊，无需附带私聊)。`,
    `- 若【公聊意愿 < 60 但 有私聊意向】：**直接输出: <私聊>@同事名字 私信内容** (纯私聊，不发大群公聊)。`,
    `- 若【公聊意愿 ≥ 60 且 有私聊意向】：**先写公开发言，并在结尾另起一行附带: <私聊>@同事名字 私信内容** (系统会自动拆分为公聊与私聊两个独立气泡)。`,
  ];

  if (activeThread && activeThread.status === 'active' && otherMemberName) {
    sections.push(
      ``,
      `# 当前私聊通道`,
      `你与 **${otherMemberName}** 此前开启过私聊 (第 **${activeThread.count}/3** 轮)。`,
      `若你认为私聊话题已达成共识或已破裂，可直接发公聊；若仍需在私信中回复对方，可按需在私聊末尾附带态度标签:`,
      `- **<同意>** (认同对方意见，终结私聊)`,
      `- **<拒绝>** (拒绝对方方案，终结私聊)`,
      `- **<想法> @${otherMemberName}** (提出补充条件继续私聊)`,
    );
  }

  sections.push(
    ``,
    `【重要规则】**禁止输出 <接棒> 标签**。若公聊意愿低于60分且无私聊意向，**严格仅输出 <跳过> 四个字符**，不要输出多余废话。`,
  );

  return sections.join('\n');
}

/**
 * 检查输出是否为跳过或沉默指令
 */
export function isSilentDecision(rawText: string | undefined): boolean {
  if (!rawText) return true;
  const trimmed = rawText.trim();
  if (
    trimmed === '<跳过>' ||
    trimmed === '【跳过】' ||
    trimmed === '跳过' ||
    trimmed === '<沉默>' ||
    trimmed === '【沉默】' ||
    trimmed === '沉默' ||
    trimmed.startsWith('<跳过>') ||
    trimmed.startsWith('【跳过】') ||
    trimmed.startsWith('<沉默>') ||
    trimmed.startsWith('【沉默】')
  ) {
    return true;
  }
  if (trimmed.length === 0) return true;
  return false;
}

/**
 * 组装订阅模式下的通用 Prompt 说明段落
 */
export function buildSubscribePromptSection(
  member: MemberConfig,
  members: MemberConfig[],
): string {
  const candidateNames = members.filter((m) => m.id !== member.id).map((m) => m.name);
  const whitelistJson = JSON.stringify({ 可互动同事白名单: candidateNames }, null, 2);

  return (
    `# 讨论模式说明(订阅模式 · 自主在线群聊)\n` +
    `本次讨论由心跳自主驱动，无需指定接棒人，不要在文末输出 <接棒> 标签。\n` +
    `【两阶段自决】发言前请先自省：1. 公聊意愿是否≥60分？ 2. 是否有必要私下找人通气？\n` +
    `- 若公聊意愿不足60分且无需私聊，直接输出 <跳过> 潜水观望；\n` +
    `- 若需公开发言，直接阐述你的观点；\n` +
    `- 若想私下找某位或多位同事单聊/通气/结盟，可在发言中(或独立)附带: <私聊>@名字 悄悄话内容 (系统会自动将公开发言与私信拆分为独立气泡发布)；\n` +
    `可互动同事白名单(严禁给自己发私聊，严禁脑补数字后缀):\n\`\`\`json\n${whitelistJson}\n\`\`\``
  );
}
