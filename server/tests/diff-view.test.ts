// diffView 纯函数测试(工单12):Edit 红绿 diff 的行级对齐/词级热区/上下文裁剪,
// 输出折叠的 3 行预览语义(CLI MAX_LINES_TO_SHOW)。
// 注意:本文件在 server vitest 运行(utils 是前端包,但纯函数无 Vue 依赖——
// 经相对路径直接 import,与 web-i18n.test.ts 跨包测 zh 词典同范式)。

import { describe, it, expect } from 'vitest';
import { buildEditDiff, foldOutput } from '../../web/src/utils/diffView';

describe('buildEditDiff(Edit 红绿)', () => {
  it('纯新增(Write):全部 add 行,removed=0', () => {
    const { lines, added, removed } = buildEditDiff('', 'function add(a,b) {\n  return a+b;\n}');
    expect(removed).toBe(0);
    expect(added).toBe(3);
    expect(lines.every((l) => l.kind === 'add')).toBe(true);
  });

  it('修改一行:remove+add 成对,context 保留', () => {
    const old = 'line1\nline2 old\nline3';
    const nw = 'line1\nline2 new\nline3';
    const { lines, added, removed } = buildEditDiff(old, nw);
    expect(added).toBe(1);
    expect(removed).toBe(1);
    const kinds = lines.map((l) => l.kind).join(',');
    expect(kinds).toContain('remove');
    expect(kinds).toContain('add');
    expect(kinds).toContain('context'); // line1/line3 保留
  });

  it('删除行:只有 remove', () => {
    const { lines, removed, added } = buildEditDiff('a\nb\nc', 'a\nc');
    expect(removed).toBe(1);
    expect(added).toBe(0);
    expect(lines.some((l) => l.kind === 'remove' && l.text === 'b')).toBe(true);
  });

  it('相同输入:全 context,零增删', () => {
    const { added, removed } = buildEditDiff('same\nsame', 'same\nsame');
    expect(added).toBe(0);
    expect(removed).toBe(0);
  });

  it('词级热区:修改行 add 带热区标记', () => {
    const { lines } = buildEditDiff('return a - b;', 'return a + b;');
    const addLine = lines.find((l) => l.kind === 'add')!;
    expect(addLine.hot).toBeDefined();
    expect(addLine.hot).toContain('+'); // 变化词被圈出
  });

  it('大上下文裁剪:远离变化的中段 context 被裁(仅留紧邻 1 行)', () => {
    const old = Array.from({ length: 20 }, (_, i) => `ctx${i}`).join('\n');
    const nw = old.replace('ctx10', 'CHANGED');
    const { lines } = buildEditDiff(old, nw);
    const ctxCount = lines.filter((l) => l.kind === 'context').length;
    // 20 行原文,若全保留 context=18;裁剪后应远小于(紧邻变化处各 1)
    expect(ctxCount).toBeLessThanOrEqual(6);
  });
});

describe('foldOutput(输出折叠,CLI 3 行预览)', () => {
  it('3 行内不折叠', () => {
    const r = foldOutput('a\nb\nc', 3);
    expect(r.hidden).toBe(0);
    expect(r.preview).toBe('a\nb\nc');
  });

  it('超 3 行:前 3 行预览 + 准确隐藏计数', () => {
    const out = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n');
    const r = foldOutput(out, 3);
    expect(r.preview).toBe('line0\nline1\nline2');
    expect(r.hidden).toBe(47);
  });

  it('尾部空行被吃掉再计数', () => {
    const r = foldOutput('a\nb\nc\nd\n\n\n', 3);
    expect(r.hidden).toBe(1);
  });
});
