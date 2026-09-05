// Agent 完整输入输出 Trace 持久化存储
// 独立存储于 data/traces/{room|direct}/{id}/{messageId}.json，与主聊天消息物理隔离，避免消息历史臃肿。

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentTraceLog } from '../core/types';
import { REPO_ROOT } from '../paths';

export type TraceScope = 'room' | 'direct';

export type TraceSummaryItem = Pick<
  AgentTraceLog,
  'messageId' | 'roomId' | 'memberId' | 'memberName' | 'adapter' | 'ts' | 'durationMs' | 'status' | 'trigger' | 'error'
>;

function traceDirFor(scope: TraceScope, id: string): string {
  const safeScope = scope === 'room' ? 'rooms' : 'direct';
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(REPO_ROOT, 'data', 'traces', safeScope, safeId);
}

function traceFileFor(scope: TraceScope, id: string, messageId: string): string {
  const safeMsgId = messageId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(traceDirFor(scope, id), `${safeMsgId}.json`);
}

/** 保存某次发言的完整 Trace 日志 */
export async function saveTrace(scope: TraceScope, id: string, trace: AgentTraceLog): Promise<void> {
  try {
    const dir = traceDirFor(scope, id);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const file = traceFileFor(scope, id, trace.messageId);
    await writeFile(file, JSON.stringify(trace, null, 2), 'utf8');
  } catch (err) {
    // Trace 写入失败不阻断核心发言业务，仅在控制台警告
    console.error(`[TraceStore] 保存 Trace 失败 (${scope}/${id}/${trace.messageId}):`, err);
  }
}

/** 按需获取单条完整 Trace 详情(懒加载) */
export async function getTrace(
  scope: TraceScope,
  id: string,
  messageId: string,
): Promise<AgentTraceLog | null> {
  try {
    const file = traceFileFor(scope, id, messageId);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as AgentTraceLog;
  } catch (err) {
    console.error(`[TraceStore] 读取 Trace 失败 (${scope}/${id}/${messageId}):`, err);
    return null;
  }
}

/** 获取指定房间或私聊的所有 Trace 概览列表(按时间倒序) */
export async function listTraces(scope: TraceScope, id: string): Promise<TraceSummaryItem[]> {
  try {
    const dir = traceDirFor(scope, id);
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    const items: TraceSummaryItem[] = [];
    for (const f of jsonFiles) {
      try {
        const raw = await readFile(path.join(dir, f), 'utf8');
        const data = JSON.parse(raw) as AgentTraceLog;
        items.push({
          messageId: data.messageId,
          roomId: data.roomId,
          memberId: data.memberId,
          memberName: data.memberName,
          adapter: data.adapter,
          ts: data.ts,
          durationMs: data.durationMs,
          status: data.status,
          trigger: data.trigger,
          error: data.error,
        });
      } catch {
        // 单个文件损坏跳过
      }
    }
    // 按时间倒序排序
    return items.sort((a, b) => b.ts - a.ts);
  } catch (err) {
    console.error(`[TraceStore] 列出 Traces 失败 (${scope}/${id}):`, err);
    return [];
  }
}
