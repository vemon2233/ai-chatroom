// traceToActivities 转换测试(工单13):落库 trace → ActivityCard 流水,
// 使落库消息展开的过程区与进行中活动卡片视觉一致。
// 覆盖:thinking 增量聚段/工具行带原参数/顺序配对语义/纯思考无过程区。

import { describe, it, expect } from 'vitest';
import { traceToActivities } from '../../web/src/utils/traceToActivity';

describe('traceToActivities(落库 trace → 活动流水)', () => {
  it('thinking 增量条目聚合为一段', () => {
    const out = traceToActivities([
      { kind: 'thinking', content: '我先看看' },
      { kind: 'thinking', content: '结构…' },
      { kind: 'tool_use', label: 'Read', content: '{"file_path":"a.ts"}' },
    ]);
    expect(out[0]).toMatchObject({ kind: 'thinking', content: '我先看看结构…' });
    expect(out[1]).toMatchObject({ kind: 'tool_use', label: 'Read' });
  });

  it('tool_use 保留原始 JSON(raw)供红绿 diff 解析', () => {
    const raw = '{"old_string":"a-b","new_string":"a+b"}';
    const out = traceToActivities([{ kind: 'tool_use', label: 'Edit', content: raw }]);
    expect(out[0]!.raw).toBe(raw);
    expect(out[0]!.content).toBe(raw); // Edit 无 command/file_path 可取,整 JSON 呈现
  });

  it('tool_use/tool_result 顺序保留(组件内就近配对)', () => {
    const out = traceToActivities([
      { kind: 'tool_use', label: 'Bash', content: '{"command":"npm test"}' },
      { kind: 'tool_result', label: 'tool:abc', content: '199 passed' },
    ]);
    expect(out.map((e) => e.kind)).toEqual(['tool_use', 'tool_result']);
    expect(out[0]!.content).toBe('npm test'); // 参数摘要:command 提取
  });

  it('text 增量条目跳过(正文独立渲染,过程区不重复)', () => {
    const out = traceToActivities([
      { kind: 'text', content: '已修复' },
      { kind: 'tool_use', label: 'Read', content: '{"file_path":"x"}' },
      { kind: 'text', content: '完毕' },
    ]);
    // text 条目被跳过:输出里只有 1 条 tool_use,无任何 text 残留
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe('tool_use');
  });

  it('纯 thinking(无工具)只出思考段——过程区判定在 Bubble 侧(steps=0 不显示)', () => {
    const out = traceToActivities([{ kind: 'thinking', content: '想了很多' }]);
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe('thinking');
  });

  it('空 trace → 空流水', () => {
    expect(traceToActivities([])).toEqual([]);
  });
});
