// 消息渲染叶子模块(仅依赖 core/types):聊天历史→prompt 文本转录 + 风格/权限说明。
// 从 prompt.ts 抽出——modes/subscribe/prompt 需要 historyText 而 prompt.ts 又 import 它,
// 曾构成 ESM 环;下沉为叶子后环全解。消费方:prompt 组装(buildPrompt/buildDeltaPrompt)、
// 心跳 prompt、direct 1v1 prompt。

import type { ChatMessage, RoomConfig, ToolPermission } from './types';

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
