import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DiscussionSummary, DiscussionSummarySnapshot, SummarySnapshotItem } from '../core/types';
import { REPO_ROOT } from '../paths';

export type SummaryScope = 'room' | 'direct';

function summariesBaseDir(scope: SummaryScope): string {
  const safeScope = scope === 'room' ? 'rooms' : 'direct';
  return path.join(REPO_ROOT, 'data', 'summaries', safeScope);
}

function summarySnapshotsDir(scope: SummaryScope, id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(summariesBaseDir(scope), safeId);
}

function legacySummaryFile(scope: SummaryScope, id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(summariesBaseDir(scope), `${safeId}.json`);
}

/** 生成短唯一 ID */
function genSnapshotId(ts: number): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `sum_${ts}_${rand}`;
}

/** 保存一份独立的摘要快照文件 */
export async function saveSummarySnapshot(
  scope: SummaryScope,
  id: string,
  summary: DiscussionSummary,
  trigger: 'auto' | 'manual' = 'auto',
): Promise<DiscussionSummarySnapshot> {
  const ts = summary.updatedAt || Date.now();
  const snapshotId = genSnapshotId(ts);
  const snapshot: DiscussionSummarySnapshot = {
    ...summary,
    id: snapshotId,
    scope,
    targetId: id,
    createdAt: ts,
    trigger,
  };

  try {
    const dir = summarySnapshotsDir(scope, id);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const file = path.join(dir, `${snapshotId}.json`);
    await writeFile(file, JSON.stringify(snapshot, null, 2), 'utf8');

    // 兼容层: 同步写一份旧路径，确保直接读取单文件的老接口不报错
    const legacyFile = legacySummaryFile(scope, id);
    await writeFile(legacyFile, JSON.stringify(summary, null, 2), 'utf8');
  } catch (err) {
    console.error(`[SummaryStore] 保存摘要快照失败 (${scope}/${id}/${snapshotId}):`, err);
  }

  return snapshot;
}

/** 兼容旧签名: 保存最新摘要 */
export async function saveSummary(
  scope: SummaryScope,
  id: string,
  summary: DiscussionSummary,
  trigger: 'auto' | 'manual' = 'auto',
): Promise<void> {
  await saveSummarySnapshot(scope, id, summary, trigger);
}

/** 获取单条指定 ID 的完整摘要快照 */
export async function getSummarySnapshot(
  scope: SummaryScope,
  id: string,
  snapshotId: string,
): Promise<DiscussionSummarySnapshot | null> {
  try {
    const safeSnapId = snapshotId.replace(/[^a-zA-Z0-9_-]/g, '');
    const file = path.join(summarySnapshotsDir(scope, id), `${safeSnapId}.json`);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as DiscussionSummarySnapshot;
  } catch (err) {
    console.error(`[SummaryStore] 读取摘要快照详情失败 (${scope}/${id}/${snapshotId}):`, err);
    return null;
  }
}

/** 获取最新讨论摘要 */
export async function getSummary(
  scope: SummaryScope,
  id: string,
): Promise<DiscussionSummary | null> {
  try {
    // 优先从快照列表取最新的一份
    const list = await listSummarySnapshots(scope, id);
    if (list.length > 0 && list[0]) {
      const detail = await getSummarySnapshot(scope, id, list[0].id);
      if (detail) return detail;
    }

    // 降级从单文件读取
    const legacyFile = legacySummaryFile(scope, id);
    if (existsSync(legacyFile)) {
      const raw = await readFile(legacyFile, 'utf8');
      return JSON.parse(raw) as DiscussionSummary;
    }
    return null;
  } catch (err) {
    console.error(`[SummaryStore] 读取最新摘要失败 (${scope}/${id}):`, err);
    return null;
  }
}

/** 获取指定目标的所有历史摘要快照列表(按时间倒序) */
export async function listSummarySnapshots(
  scope: SummaryScope,
  id: string,
): Promise<SummarySnapshotItem[]> {
  try {
    const dir = summarySnapshotsDir(scope, id);
    let jsonFiles: string[] = [];

    if (existsSync(dir)) {
      const files = await readdir(dir);
      jsonFiles = files.filter((f) => f.endsWith('.json'));
    }

    // 存量自愈: 如果目录为空但存在旧单文件，将其补录为初始快照
    if (jsonFiles.length === 0) {
      const legacyFile = legacySummaryFile(scope, id);
      if (existsSync(legacyFile)) {
        try {
          const raw = await readFile(legacyFile, 'utf8');
          const legacyData = JSON.parse(raw) as DiscussionSummary;
          if (legacyData?.text?.trim()) {
            const initialSnapshot = await saveSummarySnapshot(scope, id, legacyData, 'manual');
            return [
              {
                id: initialSnapshot.id,
                scope,
                targetId: id,
                createdAt: initialSnapshot.createdAt,
                messageCount: initialSnapshot.messageCount,
                coveredMessageId: initialSnapshot.coveredMessageId,
                trigger: initialSnapshot.trigger,
                status: initialSnapshot.status,
                error: initialSnapshot.error,
              },
            ];
          }
        } catch {
          // 忽略旧文件解析错误
        }
      }
      return [];
    }

    const items: SummarySnapshotItem[] = [];
    for (const f of jsonFiles) {
      try {
        const raw = await readFile(path.join(dir, f), 'utf8');
        const data = JSON.parse(raw) as DiscussionSummarySnapshot;
        items.push({
          id: data.id || path.basename(f, '.json'),
          scope: data.scope || scope,
          targetId: data.targetId || id,
          createdAt: data.createdAt || data.updatedAt || 0,
          messageCount: data.messageCount || 0,
          coveredMessageId: data.coveredMessageId,
          trigger: data.trigger,
          status: data.status,
          error: data.error,
        });
      } catch {
        // 跳过异常文件
      }
    }

    return items.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.error(`[SummaryStore] 列出摘要快照列表失败 (${scope}/${id}):`, err);
    return [];
  }
}
