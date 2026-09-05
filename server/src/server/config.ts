// 配置加载:agents.yaml(适配器注册表 + scout 段 + server 段)。

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { AdminConfig, ScoutConfig } from '../core/admin';
import { REPO_ROOT } from '../paths';

export interface AdapterConfig {
  displayName: string;
  kind: string;
  command: string;
  args: string[];
}

export interface AppConfig {
  adapters: Record<string, AdapterConfig>;
  admin: AdminConfig;
  scout: ScoutConfig;
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

  return {
    adapters: parsed.adapters,
    admin: adminCfg,
    scout: adminCfg,
    server: parsed.server ?? { port: 3220, host: '127.0.0.1' },
  };
}
