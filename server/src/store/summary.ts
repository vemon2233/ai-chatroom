// 讨论摘要持久化存储
// 独立存储于 data/summaries/{rooms|direct}/{id}.json，包含最新全局结构化摘要与元数据。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DiscussionSummary } from '../core/types';
import { REPO_ROOT } from '../paths';

export type SummaryScope = 'room' | 'direct';

function summaryDirFor(scope: SummaryScope): string {
  const safeScope = scope === 'room' ? 'rooms' : 'direct';
  return path.join(REPO_ROOT, 'data', 'summaries', safeScope);
}

function summaryFileFor(scope: SummaryScope, id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(summaryDirFor(scope), `${safeId}.json`);
}

/** 保存讨论摘要 */
export async function saveSummary(
  scope: SummaryScope,
  id: string,
  summary: DiscussionSummary,
): Promise<void> {
  try {
    const dir = summaryDirFor(scope);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const file = summaryFileFor(scope, id);
    await writeFile(file, JSON.stringify(summary, null, 2), 'utf8');
  } catch (err) {
    console.error(`[SummaryStore] 保存摘要失败 (${scope}/${id}):`, err);
  }
}

/** 获取最新讨论摘要 */
export async function getSummary(
  scope: SummaryScope,
  id: string,
): Promise<DiscussionSummary | null> {
  try {
    const file = summaryFileFor(scope, id);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as DiscussionSummary;
  } catch (err) {
    console.error(`[SummaryStore] 读取摘要失败 (${scope}/${id}):`, err);
    return null;
  }
}
