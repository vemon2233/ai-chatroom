// 落库 trace → 活动卡片流水转换(工单13):
// detail.trace(TraceEntry[])是落库的工作过程档案;本函数把它还原成
// ActivityCard 的 ActivityItem 流水,使落库消息展开的过程区与进行中的
// 活动卡片视觉完全一致(复用同一组件)。
// 配对语义:TraceEntry 无 id 字段——tool_result 顺序配对最近的未配对 tool_use
// (单 agent 串行执行下可靠;并发子代理场景退化为近似)。

import type { ActivityItem } from '@/store';
import { summarizeToolInput } from './traceToActivityHelpers';

/** 相邻 thinking 条目聚合成一段(trace 落库是逐 delta 条目,展示按段) */
export function traceToActivities(trace: Array<{ kind: string; label?: string; content: string }>): ActivityItem[] {
  const out: ActivityItem[] = [];
  let pendingThinking = '';
  const flush = () => {
    const s = pendingThinking.trim();
    if (s) out.push({ kind: 'thinking', label: '', content: s, ts: 0 });
    pendingThinking = '';
  };
  for (const e of trace) {
    if (e.kind === 'thinking') {
      pendingThinking += e.content;
    } else if (e.kind === 'tool_use') {
      flush();
      out.push({ kind: 'tool_use', label: e.label ?? 'tool', content: summarizeToolInput(e.content), raw: e.content, ts: 0 });
    } else if (e.kind === 'tool_result') {
      flush();
      out.push({ kind: 'tool_result', label: e.label ?? 'tool', content: e.content, ts: 0 });
    }
    // text 增量条目:正文已有,过程区不重复(活动卡片里正文独立显示)
  }
  flush();
  return out;
}
