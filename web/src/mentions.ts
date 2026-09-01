// @提及 的解析与渲染切分——输入框高亮与聊天气泡共用的唯一真源。
// token 语法与后端 orchestrator.parseUserCommand 对齐:@ + 非空白/非@/非逗号连续字符。

export interface TextSegment {
  text: string;
  mention: boolean;
}

const MENTION_TOKEN = /@[^\s@,，。]+/g;

/** 把文本切成 [普通段, @提及段, …](渲染层据此着色)。 */
export function splitMentions(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx), mention: false });
    out.push({ text: m[0], mention: true });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

/**
 * 检测光标前是否处于"激活的 @ 提及"中(微信式弹选触发条件)。
 * @before 光标前的全部文本;返回 @ 的起始下标与已输入的查询串。
 * 要求 @ 前是行首或空白(避免误触邮箱等);token 内出现空白即终止。
 */
export function detectMention(before: string): { start: number; query: string } | null {
  const m = before.match(/(?:^|\s)@([^\s@,，。]*)$/);
  if (!m) return null;
  const query = m[1] ?? '';
  return { start: before.length - query.length - 1, query };
}
