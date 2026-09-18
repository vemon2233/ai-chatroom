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

/**
 * 从文本中精准提取接棒意图与目标(双语并集)。
 * 适用于 AI 尾行接棒与用户指令前缀接棒。
 */
export function extractBatonTarget(text: string): { type: 'end' | 'to-user' | 'baton'; target?: string } | null {
  if (!text) return null;
  const m = text.match(BATON_LINE);
  if (!m) return null;
  const directive = (m[1] ?? '').trim();
  if (BATON_END_WORDS.test(directive)) {
    return { type: 'end' };
  }
  const atHit = directive.match(AT_NAME);
  const rawName = (atHit?.[1] ?? directive.split(/\s+/)[0] ?? '').trim();
  if (!rawName) return null;
  if (USER_NAME_ALIASES.includes(rawName.toLowerCase())) {
    return { type: 'to-user' };
  }
  return { type: 'baton', target: rawName };
}

/**
 * 剥除发言文本中的接棒指令，保留附带发言正文(双语并集)。
 * - 若仅包含指令与目标(如 "<接棒> @刘备(于和伟)"):回退保留 "@刘备(于和伟)"，避免气泡空屏。
 * - 若包含后续正文(如 "<接棒> @刘备(于和伟) 接着奏乐接着舞"):剥除指令，完整保留后续正文。
 * - 若为 AI 发言的单独尾行指令:整行剥除，保留上方正文。
 */
export function stripBaton(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const resultLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(.*?)(?:<接棒>|【接棒】|<pass>|<PASS>)\s*(.*)$/);
    if (!match) {
      resultLines.push(line);
      continue;
    }

    const prefix = match[1] ?? '';
    const remainder = match[2] ?? '';

    let body = remainder;
    const atHit = remainder.match(/^(@[^\s@,，。]+)\s*(.*)$/);
    if (atHit) {
      body = atHit[2] ?? '';
    } else {
      const wordHit = remainder.match(/^([^\s@,，。]+)\s*(.*)$/);
      if (wordHit) {
        const candidate = wordHit[1]!;
        if (BATON_END_WORDS.test(candidate) || USER_NAME_ALIASES.includes(candidate.toLowerCase())) {
          body = wordHit[2] ?? '';
        }
      }
    }

    const preserved = (prefix + (body ? (prefix ? ' ' : '') + body : '')).trim();
    if (preserved) {
      resultLines.push(preserved);
    }
  }

  const cleaned = resultLines.join('\n').trim();
  if (cleaned) {
    return cleaned;
  }

  const targetHit = extractBatonTarget(text);
  if (targetHit?.target) {
    return `@${targetHit.target}`;
  }
  return text.trim();
}

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

// ---------- 私聊(订阅模式) ----------

export const DM_TAGS = {
  zh: '<私聊>',
  zhLegacy: '【私聊】',
  en: '<dm>',
} as const;

export function dmTagFor(lang: ProtocolLang): string {
  return lang === 'en' ? DM_TAGS.en : DM_TAGS.zh;
}

/** 私聊行匹配(双语并集;英文大小写双写) */
export const DM_LINE = /(?:<私聊>|【私聊】|<dm>|<DM>)\s*(.+)/;
/** 私聊标签全文扫描(切 chunk 用,g 标志) */
export const DM_TAG_GLOBAL = /(?:<私聊>|【私聊】|<dm>|<DM>)/g;
/** 私聊尾行剥除(g 标志,整行删) */
export const DM_STRIP = /(?:<私聊>|【私聊】|<dm>|<DM>)[^\n]*/g;

// ---------- 握手(私聊态度三件套) ----------

export type HandshakeKind = 'agree' | 'reject' | 'idea';

export const HANDSHAKE_TAGS: Record<HandshakeKind, { zh: string; en: string }> = {
  agree: { zh: '同意', en: 'agree' },
  reject: { zh: '拒绝', en: 'decline' },
  idea: { zh: '想法', en: 'idea' },
};

/** 按语言取发射侧握手标签(完整尖括号形式,如 '<agree>') */
export function handshakeTagFor(kind: HandshakeKind, lang: ProtocolLang): string {
  const t = HANDSHAKE_TAGS[kind];
  return `<${lang === 'en' ? t.en : t.zh}>`;
}

/** 握手行匹配(双语并集;捕获词用于 kind 判定) */
export const HANDSHAKE_LINE = /<(同意|拒绝|想法|agree|decline|idea|AGREE|DECLINE|IDEA)>\s*(.*)/;
/** 握手标签剥除(g 标志,整行删) */
export const HANDSHAKE_STRIP = /<(?:同意|拒绝|想法|agree|decline|idea|AGREE|DECLINE|IDEA)>[^\n]*/g;

export function handshakeKindOf(word: string): HandshakeKind | undefined {
  const w = word.toLowerCase();
  for (const kind of Object.keys(HANDSHAKE_TAGS) as HandshakeKind[]) {
    const t = HANDSHAKE_TAGS[kind];
    if (w === t.zh || w === t.en) return kind;
  }
  return undefined;
}

// ---------- 正文清洗前缀(AI 输出残留标签词;中英并集) ----------

/** 私聊正文开头的残留前缀(如 "私聊: xxx" / "private: xxx");英文词须带冒号(裸词是正常正文) */
export const PRIVATE_PREFIX_STRIP = /^\s*(?:私聊(?:部分)?|悄悄话|密谋|private|dm)[:：]\s*/i;
/** 公聊正文开头的残留前缀(如 "公开发言: xxx" / "public: xxx");英文词须带冒号 */
export const PUBLIC_PREFIX_STRIP = /^\s*(?:公开发言(?:部分)?|公开回复|台前发言|公聊(?:部分)?|public(?: reply| speech| statement)?|on stage)[:：]\s*/i;

// ---------- @名字(audience 内层;字符类与现状一致,额外容忍冒号截断) ----------

/** chunk 开头 @名字提取(audience:89,带 \s* 前导) */
export const AT_TARGET = /^\s*@([^\s@,，。:：\n]+)/;
/** chunk 开头裸名字提取(audience:101 容错,无 @) */
export const AT_NAME_LOOSE = /^([^\s@,，。:：\n]+)/;
/** 容错提取(audience:165/165,@ 可选) */
export const AT_NAME_OPTIONAL = /@?([^\s@,，。:：\n]+)/;

// ---------- 语气语义兜底(无显式标签时;中英语料并集,不论当前语言) ----------

/** 同意/结盟倾向(行首整词;英文词带 \b 防内嵌) */
export const INFER_AGREE = /^(?:(?:好|可以|行|成|没问题|成交|一言为定|依你|就依你|听你的|赞同|认同|同意|接受|按你说的办|依你说的办|sure|ok|okay|deal|agreed|i agree|accepted|fine by me|count me in)[\s，。！!：:]*|.*(?:一言为定|达成同盟|结盟已成|此约已定|此约便定|\bdeal\b))/i;
/** 拒绝倾向 */
export const INFER_REJECT = /^(?:(?:不行|拒绝|休想|不妥|免谈|绝不|恕难从命|我不同意|不答应|no way|refuse|rejected|i decline|i disagree|absolutely not|out of the question)[\s，。！!：:]*|.*(?:绝无可能|绝不同意|绝不答应|断难从命|\bnever\b))/i;
/** 想法/反议价/补充条件倾向 */
export const INFER_IDEA = /^(?:(?:不过|但|我有不同想法|我的条件是|不如这样|另有一言|however|but|i have a (?:different idea|counterproposal)|my condition is|what if|counteroffer)[\s，。！!：:]*)/i;
