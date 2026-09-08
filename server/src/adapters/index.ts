// 适配器注册表:kind → 实现。
// 依赖注入点:测试用 registerAdapter 注入 fake,生产走 agents.yaml 的 kind。

import type { AgentAdapter } from './base';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { geminiAdapter } from './gemini';
import { qwenAdapter } from './qwen';

export const adapters: Record<string, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  qwen: qwenAdapter,
};

export function getAdapter(kind: string): AgentAdapter {
  const a = adapters[kind];
  if (!a) throw new Error(`未知适配器类型: ${kind}(检查 config/agents.yaml 的 kind 字段)`);
  return a;
}

/** 测试注入:替换某 kind 的实现(fake adapter)。 */
export function registerAdapter(kind: string, impl: AgentAdapter): void {
  adapters[kind] = impl;
}

export type { AgentAdapter, AgentEvent, SpeakRequest, SpeakOutcome, AgentPhase } from './base';
