// Edit 工具的红绿 diff 渲染(工单12,对齐 claude CLI 视觉):
// 数据源 = tool_use input 里的 old_string/new_string(JSON),
// 渲染 = 行级红绿底 + 词级高亮(行内真正变化的词更深一块)。
// 纯前端零依赖:词级用公共前/后缀收缩的朴素算法(两端夹逼),
// 不追求 Myers 最优 diff——预览用途,朴素解足够且 O(n)。

export interface DiffLine {
  kind: 'add' | 'remove' | 'context';
  /** 词片段:高亮位仅当词真正变化(词级高亮) */
  text: string;
  /** 行内高亮片段(简版:变化的中间段) */
  hot?: string;
  hotStart?: number;
}

/** 词级朴素 diff:剥公共前缀/后缀,中间段为"变化热区" */
function wordDiff(oldS: string, newS: string): { text: string; hot?: string; hotStart?: number } {
  // 公共前缀
  let pre = 0;
  const minLen = Math.min(oldS.length, newS.length);
  while (pre < minLen && oldS[pre] === newS[pre]) pre++;
  // 公共后缀(不越过前缀)
  let suf = 0;
  while (
    suf < minLen - pre &&
    oldS[oldS.length - 1 - suf] === newS[newS.length - 1 - suf]
  ) suf++;
  const hotOld = oldS.slice(pre, oldS.length - suf);
  const hotNew = newS.slice(pre, newS.length - suf);
  if (!hotOld && !hotNew) return { text: newS };
  return { text: newS, hot: hotNew || undefined, hotStart: hotNew ? pre : undefined };
}

/**
 * 由 Edit 的 old_string/new_string 生成 diff 行。
 * 策略(对齐 CLI 语义):
 *  - old 有 new 无 → remove 行(红)
 *  - new 有 old 无 → add 行(绿)
 *  - 行双方都有 → 逐行配对,相同为 context(白),不同则 remove+add 成对(词级热区标出)
 */
export function buildEditDiff(oldStr: string, newStr: string): { lines: DiffLine[]; added: number; removed: number } {
  const oldLines = oldStr === '' ? [] : oldStr.split('\n');
  const newLines = newStr === '' ? [] : newStr.split('\n');
  const lines: DiffLine[] = [];

  // 朴素对齐:公共前缀块 → 中段(old 全 remove + new 全 add,短中段逐行配对)→ 公共后缀块
  let pre = 0;
  while (pre < oldLines.length && pre < newLines.length && oldLines[pre] === newLines[pre]) pre++;
  let suf = 0;
  while (
    suf < oldLines.length - pre && suf < newLines.length - pre &&
    oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]
  ) suf++;

  for (let i = 0; i < pre; i++) lines.push({ kind: 'context', text: oldLines[i]! });

  const oldMid = oldLines.slice(pre, oldLines.length - suf);
  const newMid = newLines.slice(pre, newLines.length - suf);
  const midLen = Math.max(oldMid.length, newMid.length);
  for (let i = 0; i < midLen; i++) {
    const o = oldMid[i];
    const n = newMid[i];
    if (o === undefined && n !== undefined) {
      lines.push({ kind: 'add', text: n });
    } else if (n === undefined && o !== undefined) {
      lines.push({ kind: 'remove', text: o });
    } else if (o !== n) {
      // 成对 remove+add,add 行带词级热区
      lines.push({ kind: 'remove', text: o! });
      const w = wordDiff(o!, n!);
      lines.push({ kind: 'add', text: w.text, hot: w.hot, hotStart: w.hotStart });
    } else {
      lines.push({ kind: 'context', text: o! });
    }
  }

  for (let i = oldLines.length - suf; i < oldLines.length; i++) {
    lines.push({ kind: 'context', text: oldLines[i]! });
  }

  // context 行只保留紧邻变化处的各 1 行(对齐 CLI CONTEXT_LINES 克制)
  const trimmed: DiffLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const near = lines[i - 1]?.kind !== 'context' || lines[i + 1]?.kind !== 'context';
    if (lines[i]!.kind !== 'context' || near) trimmed.push(lines[i]!);
  }

  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'remove').length;
  return { lines: trimmed, added, removed };
}

/** 输出折叠预览(对齐 CLI MAX_LINES_TO_SHOW=3):前 N 行 + "+M 行"折叠 */
export function foldOutput(output: string, maxLines = 3): { preview: string; hidden: number } {
  const all = output.replace(/\n+$/, '').split('\n');
  if (all.length <= maxLines) return { preview: all.join('\n'), hidden: 0 };
  // 尾部折叠(CLI 显示头部;长输出尾部往往更有用——bash 诊断在尾行。
  // 取 CLI 同语义:头部预览,但隐藏计数准确)
  return { preview: all.slice(0, maxLines).join('\n'), hidden: all.length - maxLines };
}
