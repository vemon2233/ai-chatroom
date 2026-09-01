// 项目上下文采集:为绑定项目目录的房间生成"地图"(目录树概览),
// 注入成员 prompt,引导 agent 用工具自主深入探索。
// 这是数据卫生(排除依赖/构建噪声),不是体积限制——用户选择不限制。

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** 探索时跳过的目录(依赖、构建产物、版本库——对讨论无价值且巨大) */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', 'coverage', '__pycache__', '.venv',
  'venv', '.idea', '.vs', '.gradle', 'vendor', 'Pods', '.terraform',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
  'poetry.lock', 'composer.lock', 'Gemfile.lock',
]);

/** 单目录下收集(广度优先,限制条目数防卡死;深度默认 3) */
async function walk(dir: string, depth: number, maxDepth: number, lines: string[], budget: { count: number }): Promise<void> {
  if (depth > maxDepth || budget.count <= 0) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 无权限等,静默跳过
  }
  // 目录在前、字母序;跳过噪声
  const sorted = entries
    .filter((e) => !SKIP_DIRS.has(e.name) && !SKIP_FILES.has(e.name))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));

  for (const e of sorted) {
    if (budget.count <= 0) {
      lines.push(`${'  '.repeat(depth)}… (条目过多,已截断)`);
      return;
    }
    lines.push(`${'  '.repeat(depth)}${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
    budget.count--;
    if (e.isDirectory()) {
      await walk(path.join(dir, e.name), depth + 1, maxDepth, lines, budget);
    }
  }
}

export interface ProjectContext {
  /** 项目根绝对路径 */
  root: string;
  /** 目录树文本(带 emoji 缩进) */
  tree: string;
}

/** 采集项目上下文(带 5 分钟内存缓存,避免每个成员发言都重扫目录) */
const cache = new Map<string, { at: number; ctx: ProjectContext }>();
const CACHE_MS = 5 * 60 * 1000;

export async function collectProjectContext(root: string): Promise<ProjectContext> {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ctx;

  // 验证目录存在
  try {
    const s = await stat(root);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch {
    return { root, tree: '(项目目录不可访问)' };
  }

  const lines: string[] = [];
  await walk(root, 0, 3, lines, { count: 400 });
  const ctx: ProjectContext = { root, tree: lines.join('\n') };
  cache.set(root, { at: Date.now(), ctx });
  return ctx;
}
