// Gemini CLI 适配器(gemini -o stream-json,prompt 走 stdin)。
// 实测事件流(v0.58.0):
//   {"type":"init","session_id":"...","model":"auto"}                          — 会话元数据
//   {"type":"message","role":"user","content":"..."}                            — 输入回显(忽略)
//   {"type":"message","role":"assistant","content":"增量","delta":true}          — 流式正文增量
//   {"type":"tool_use","name":..,"args":..} / {"type":"tool_result",..}          — 工具事件
//   {"type":"result","status":"success","stats":{"input_tokens",..}}            — 终局
//   {"type":"result","status":"error","error":{"message":..}}                    — 失败
// 注意:result.success 不带 response 字段,最终全文 = assistant message 增量累积。
// 权限三档经 --approval-mode 硬闸:plan(只读)/auto_edit(可写)/yolo(全开)。
// ⚠️ 本机 gemini 认证/配额受限(已知边界),plan 拦写未 e2e 实测,档位语义按 CLI 文档。

import type { ToolPermission } from '../core/types';
import type { AgentAdapter, AgentEvent, SpeakRequest } from './base';
import { runCliHarness, tryParseJson } from './proc';

/** 工具权限档位 → gemini CLI 参数(翻译职责在本层) */
export function geminiPermissionArgs(p: ToolPermission | undefined): string[] {
  switch (p) {
    case 'readwrite': return ['--approval-mode', 'auto_edit'];
    case 'full': return ['--approval-mode', 'yolo'];
    case 'readonly':
    default: return ['--approval-mode', 'plan'];
  }
}

export const geminiAdapter: AgentAdapter = {
  speak(req: SpeakRequest, onEvent: (ev: AgentEvent) => void) {
    // resume:gemini 用 --resume <id|latest>(见 agents.yaml 的 args 不含 resume;由本层拼接)
    const resumeArgs = req.resumeSessionId ? ['--resume', req.resumeSessionId] : [];
    // headless 必须显式信任工作目录(隔离 cwd 天然不在用户信任列表;实测不加则 code=55 秒退)
    // ——且实测工作区不受信时 CLI 会把 --approval-mode 强制降级为 default,信任是权限档位生效前提
    const trustedReq = {
      ...req,
      args: [...req.args, ...geminiPermissionArgs(req.permission)],
      env: { GEMINI_CLI_TRUST_WORKSPACE: 'true', ...req.env },
    };
    onEvent({ member: req.member, phase: 'thinking' });
    let result = '';

    const h = runCliHarness(trustedReq, resumeArgs, {
      onLine: (line) => {
        const obj = tryParseJson(line);
        if (!obj) return; // 纯文本行(warning 等)不进正文

        const type: string = obj.type ?? '';

        if (type === 'init' && typeof obj.session_id === 'string' && obj.session_id) {
          onEvent({ member: req.member, phase: 'thinking', sessionId: obj.session_id });
          return;
        }

        if (type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string') {
          result += obj.content;
          onEvent({ member: req.member, phase: 'streaming', textDelta: obj.content });
          return;
        }

        if (type === 'tool_use') {
          onEvent({
            member: req.member,
            phase: 'thinking',
            toolUse: { name: String(obj.name ?? 'gemini-tool'), input: JSON.stringify(obj.args ?? obj).slice(0, 2000) },
          });
          return;
        }
        if (type === 'tool_result') {
          onEvent({
            member: req.member,
            phase: 'thinking',
            toolResult: { name: String(obj.name ?? 'gemini-tool'), output: String(obj.output ?? obj.result ?? '').slice(0, 2000) },
          });
          return;
        }

        if (type === 'result') {
          if (obj.status === 'error') {
            h.finish(false, String(obj.error?.message ?? obj.error ?? 'Gemini 错误'));
            return;
          }
          // success:终局事件,带聚合用量
          const usage = obj.stats && (obj.stats.input_tokens != null || obj.stats.output_tokens != null)
            ? { inputTokens: obj.stats.input_tokens, outputTokens: obj.stats.output_tokens }
            : undefined;
          onEvent({ member: req.member, phase: 'done', result, usage });
          h.settle(); // 已发 done,阻止 close 兜底重发
        }
      },
    }, onEvent);

    return {
      done: h.done.then((outcome) => ({ ...outcome, result: result || outcome.result })),
      cancel: h.cancel,
    };
  },
};
