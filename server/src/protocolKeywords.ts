// 协议关键字真源(全工程唯一):所有被"解析回来"的控制标签、词表与正则。
// 分层纪律:根级零依赖纯常量叶子(同 paths.ts 范式)——core/store/web 三方皆可引,
// 严禁 import 任何其他模块(含 core)。
//
// 双语语义:
//  - 匹配 = 并集(不论当前语言,中英标签都能解析:历史中文消息/英文模式输出/
//    AI 不听话混写,全兼容)
//  - 发射(prompt 教学)= 按语言选一侧:batonTagFor(lang) 等取单侧字面量
// 调用方:core(baton/audience/orchestrator/prompt)、store/trace(统计分类)、
//        web(MessageBubble/exportMarkdown 意图徽章,经 @server 别名 runtime import)。
// ⚠️ web/vite.config.ts 的 @server type-only 约定对此文件开例外——本文件必须保持零依赖。

export type ProtocolLang = 'zh' | 'en';

// ---------- 接棒 ----------

export const BATON_TAGS = {
  zh: '<接棒>',
  /** 旧语法,仅中文(兼容旧 session 记忆惯性) */
  zhLegacy: '【接棒】',
  en: '<pass>',
} as const;

/** 按语言取发射侧标签(prompt 教学用) */
export function batonTagFor(lang: ProtocolLang): string {
  return lang === 'en' ? BATON_TAGS.en : BATON_TAGS.zh;
}

/** 接棒行匹配(双语并集;英文侧大小写双写) */
export const BATON_LINE = /(?:<接棒>|【接棒】|<pass>|<PASS>)\s*(.+)/;

/** 接棒尾行剥除(g 标志,整行删) */
export const BATON_STRIP = /(?:<接棒>|【接棒】|<pass>|<PASS>)[^\n]*/g;

/**
 * 接棒结束关键词(中英语料并集,不区分当前语言)。
 * 英文词必须带 \b:防 "recommend"/"attend" 内嵌 "end" 误触发。
 */
export const BATON_END_WORDS = /结束|收敛|无需|到此|\b(?:end|conclude|wrap)\b/i;

/** @名字提取(截断符:空白、@、中英逗号、中文句号——现状字符类不动) */
export const AT_NAME = /@([^\s@,，。]+)/;
export const AT_NAME_GLOBAL = /@([^\s@,，。]+)/g;

/** 用户/房主代称(接棒目标指向用户时的名字判定;现状已双语) */
export const USER_NAME_ALIASES: string[] = ['用户', 'user'];

// ---------- 沉默/跳过(订阅模式心跳自决) ----------

/** 精确等于即沉默(中英并集) */
export const SILENT_EXACT: readonly string[] = [
  '<跳过>', '【跳过】', '跳过', '<沉默>', '【沉默】', '沉默',
  '<skip>', '<Skip>', '<SKIP>', 'skip',
  '<silent>', '<Silent>', '<SILENT>', 'silent',
];
/** 前缀即沉默(标签后跟了多余说明的容错) */
export const SILENT_PREFIX: readonly string[] = [
  '<跳过>', '【跳过】', '<沉默>', '【沉默】',
  '<skip>', '<Skip>', '<SKIP>', '<silent>', '<Silent>', '<SILENT>',
];

/** 沉默判定唯一真源(空文本/undefined 同判沉默——现状语义) */
export function isSilentText(raw: string | undefined): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  return (
    SILENT_EXACT.includes(trimmed.toLowerCase()) ||
    SILENT_EXACT.includes(trimmed) ||
    SILENT_PREFIX.some((p) => trimmed.startsWith(p))
  );
}

/** trace 统计用:结果文本包含跳过标签(中英并集;不判空文本——统计语义) */
export const SKIP_TAG_IN_RESULT = /<跳过>|【跳过】|<skip>|<silent>/i;
