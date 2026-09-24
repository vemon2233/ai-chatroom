// 消息渲染叶子模块(仅依赖 core/types):聊天历史→prompt 文本转录 + 风格/权限说明。
// 从 prompt.ts 抽出——modes/subscribe/prompt 需要 historyText 而 prompt.ts 又 import 它,
// 曾构成 ESM 环;下沉为叶子后环全解。消费方:prompt 组装(buildPrompt/buildDeltaPrompt)、
// 心跳 prompt、direct 1v1 prompt。
// i18n:转录标签/指令句走 promptTexts 词典(lang 尾参,缺省 zh 与现状逐字节一致)。

import type { ChatMessage, RoomConfig, ToolPermission } from './types';
import type { Lang } from './i18n/lang';
import { pt } from './i18n/promptTexts';

/**
 * 3 档用户规则豁免纯函数:从 source 找回 window 遗漏的最高指令档用户公聊消息,按时间序前置。
 * 「哪些消息进 prompt」的常驻规则策略——群聊/私聊全量视窗组装与 historyText 截断共用
 * (与 buildInjectionWindow 的锚点前活跃私聊豁免同范式:选消息归视窗层,本叶子只提供策略)。
 */
export function pinVital(
  source: readonly ChatMessage[],
  window: readonly ChatMessage[],
): ChatMessage[] {
  const pinned = source.filter(
    (m) =>
      m.importance === 3 &&
      m.from === 'user' &&
      (!m.audience || m.audience.length === 0) &&
      !window.includes(m),
  );
  return pinned.length ? [...pinned, ...window] : [...window];
}

/** 聊天历史 → 文本转录(带发言者名、受众区分与高权重 Markdown 格式)。recent 限制条数以控制 token;
 *  3 档用户规则经 pinVital 豁免截断(规则常驻,不被 recent 窗口挤出)。 */
export function historyText(
  messages: ChatMessage[],
  recent = 40,
  viewerId?: string,
  viewerName?: string,
  lang: Lang = 'zh',
): string {
  const slice = pinVital(messages, messages.slice(-recent));
  return slice
    .map((m) => {
      // 1. 私聊密信处理
      if (m.audience && m.audience.length > 0) {
        if (viewerId && m.from === viewerId) {
          return pt(lang, 'r.privateFromYou', { text: m.text });
        }
        if (viewerId && m.audience.includes(viewerId)) {
          return pt(lang, 'r.privateToYou', { name: m.fromName, text: m.text });
        }
        return pt(lang, 'r.privateOther', { name: m.fromName, text: m.text });
      }

      // 1.5 用户重要性分档(优先于 @提及判定:规则比点名更硬;仅用户公聊消息带此字段)
      if (m.importance === 3) {
        return pt(lang, 'r.userRule', { name: m.fromName, text: m.text });
      }
      if (m.importance === 2) {
        return pt(lang, 'r.userImportant', { name: m.fromName, text: m.text });
      }

      // 2. 全员公聊处理 (检测是否 @提及了当前成员)
      const isMentioned =
        (viewerName && m.text.includes(`@${viewerName}`)) ||
        (viewerId && m.text.includes(`@${viewerId}`));

      if (isMentioned) {
        return pt(lang, 'r.mentioned', { name: m.fromName, text: m.text });
      }
      return pt(lang, 'r.publicMsg', { name: m.fromName, text: m.text });
    })
    .join('\n\n');
}

/** 发言长度风格 → prompt 指令 */
export function lengthBrief(style: RoomConfig['speechLength'], lang: Lang = 'zh'): string {
  switch (style) {
    case 'long':
      return pt(lang, 'r.lengthLong');
    case 'normal':
      return pt(lang, 'r.lengthNormal');
    case 'short':
    default:
      return pt(lang, 'r.lengthShort');
  }
}

/** 工具权限档位 → 各成员 prompt 里的能力说明(与适配器的 CLI 参数映射对应) */
export function permissionBrief(p: ToolPermission | undefined, lang: Lang = 'zh'): string {
  switch (p) {
    case 'readwrite':
      return pt(lang, 'r.permReadwrite');
    case 'full':
      return pt(lang, 'r.permFull');
    case 'readonly':
    default:
      return pt(lang, 'r.permReadonly');
  }
}
