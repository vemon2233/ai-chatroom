// 配置加载:agents.yaml(适配器注册表 + admin 段 + server 段)。

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { AdminConfig } from '../core/admin';
import { REPO_ROOT } from '../paths';

export interface AdapterConfig {
  displayName: string;
  kind: string;
  command: string;
  args: string[];
}

import type { SummaryConfig } from '../core/types';

export interface AppConfig {
  adapters: Record<string, AdapterConfig>;
  admin: AdminConfig;
  summary: SummaryConfig;
  /** 单次发言超时毫秒数(0=无限;工单05) */
  speakTimeoutMs: number;
  server: { port: number; host: string };
}

const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'agents.yaml');

export async function loadConfig(): Promise<AppConfig> {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`找不到配置文件: ${CONFIG_PATH}`);
  }
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const parsed = parse(raw) as any;
  if (!parsed.adapters || typeof parsed.adapters !== 'object') {
    throw new Error('agents.yaml 缺少 adapters 配置');
  }
  const adminCfg: AdminConfig = {
    adapter: parsed.admin?.adapter ?? parsed.scout?.adapter ?? 'claude',
    model: parsed.admin?.model ?? parsed.scout?.model ?? 'haiku',
    allowedTools: parsed.admin?.allowedTools ?? parsed.scout?.allowedTools ?? 'Read Glob Grep',
    timeoutMs: parsed.admin?.timeoutMs ?? parsed.scout?.timeoutMs ?? 180000,
    maxRetries: parsed.admin?.maxRetries ?? parsed.scout?.maxRetries ?? 2,
  };

  const summaryCfg: SummaryConfig = {
    model: parsed.summary?.model ?? adminCfg.model ?? 'haiku',
    autoThreshold: parsed.summary?.autoThreshold ?? 30,
    privateThreshold: parsed.summary?.privateThreshold ?? 20,
    compactThreshold: parsed.summary?.compactThreshold ?? 40,
  };

  return {
    adapters: parsed.adapters,
    admin: adminCfg,
    summary: summaryCfg,
    speakTimeoutMs: typeof parsed.speakTimeoutMs === 'number' && parsed.speakTimeoutMs > 0 ? parsed.speakTimeoutMs : 0,
    server: parsed.server ?? { port: 3220, host: '127.0.0.1' },
  };
}

