// 配置加载:agents.yaml(适配器注册表 + scout 段 + server 段)。

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { ScoutConfig } from '../core/scout';
import { REPO_ROOT } from '../paths';

export interface AdapterConfig {
  displayName: string;
  kind: string;
  command: string;
  args: string[];
}

export interface AppConfig {
  adapters: Record<string, AdapterConfig>;
  scout: ScoutConfig;
  server: { port: number; host: string };
}

const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'agents.yaml');

export async function loadConfig(): Promise<AppConfig> {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`找不到配置文件: ${CONFIG_PATH}`);
  }
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const parsed = parse(raw) as Partial<AppConfig>;
  if (!parsed.adapters || typeof parsed.adapters !== 'object') {
    throw new Error('agents.yaml 缺少 adapters 配置');
  }
  return {
    adapters: parsed.adapters,
    scout: {
      adapter: parsed.scout?.adapter ?? 'claude',
      model: parsed.scout?.model ?? 'haiku',
      allowedTools: parsed.scout?.allowedTools ?? 'Read Glob Grep',
      timeoutMs: parsed.scout?.timeoutMs ?? 180000,
      maxRetries: parsed.scout?.maxRetries ?? 2,
    },
    server: parsed.server ?? { port: 3220, host: '127.0.0.1' },
  };
}
