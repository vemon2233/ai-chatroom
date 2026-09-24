// Qwen Code CLI 适配器(qwen -o stream-json,prompt 走 stdin)。
// Qwen Code 是 gemini-cli 的 fork,但事件 schema 是自己的 Claude-code 风格:
//   {"type":"system","subtype":"init","session_id":"..."}                       — 会话元数据
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}    — 正文(整段;可能混 thinking 块)
//   {"type":"result","subtype":"success","result":"全文","usage":{...}}          — 终局(含全文与用量)
//   {"type":"result","subtype":"error_during_execution","error":{"message":..}}  — 失败
// resume:`qwen -r <session_id>`;非交互认证:--auth-type gemini + GEMINI_API_KEY(或 qwen-oauth 登录态)。
// 权限三档经 --approval-mode 硬闸(v0.15.10 实测:plan 拦写/auto-edit 与 yolo 放写)。

import type { ToolPermission } from '../core/types';
import type { AgentAdapter, AgentEvent, SpeakRequest } from './base';
import { runCliHarness, tryParseJson } from './proc';

/** 工具权限档位 → qwen CLI 参数(翻译职责在本层) */
export function qwenPermissionArgs(p: ToolPermission | undefined): string[] {
  switch (p) {
    case 'readwrite': return ['--approval-mode', 'auto-edit'];
    case 'full': return ['--approval-mode', 'yolo'];
    case 'readonly':
    default: return ['--approval-mode', 'plan'];
  }
}

export const qwenAdapter: AgentAdapter = {
  speak(req: SpeakRequest, onEvent: (ev: AgentEvent) => void) {
    const resumeArgs = req.resumeSessionId ? ['--resume', req.resumeSessionId] : [];
    const permReq = { ...req, args: [...req.args, ...qwenPermissionArgs(req.permission)] };
    onEvent({ member: req.member, phase: 'thinking' });
    let result = '';

    const h = runCliHarness(permReq, resumeArgs, {
      onLine: (line) => {
        const obj = tryParseJson(line);
        if (!obj) return; // 纯文本行(升级提示等)不进正文

        const type: string = obj.type ?? '';

        if (type === 'system' && obj.subtype === 'init' && typeof obj.session_id === 'string' && obj.session_id) {
          onEvent({ member: req.member, phase: 'thinking', sessionId: obj.session_id });
          return;
        }

        if (type === 'assistant' && Array.isArray(obj.message?.content)) {
          for (const block of obj.message.content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              // assistant 事件为整段快照而非增量:发增量差值,重复行不会双计
              const delta = block.text.startsWith(result) ? block.text.slice(result.length) : block.text;
              if (!delta) continue;
              result += delta;
              onEvent({ member: req.member, phase: 'streaming', textDelta: delta });
            }
          }
          return;
        }

        if (type === 'result') {
          if (obj.is_error || obj.error) {
            h.finish(false, String(obj.error?.message ?? obj.error ?? 'Qwen 错误'));
            return;
          }
          // success:result 字段是全文权威(取代累积值);usage 含 total_tokens
          const finalText = typeof obj.result === 'string' && obj.result ? obj.result : result;
          result = finalText;
          const usage = obj.usage && (obj.usage.input_tokens != null || obj.usage.output_tokens != null)
            ? { inputTokens: obj.usage.input_tokens, outputTokens: obj.usage.output_tokens }
            : undefined;
          onEvent({ member: req.member, phase: 'done', result: finalText, usage });
          h.settle();
        }
      },
    }, onEvent);

    return {
      done: h.done.then((outcome) => ({ ...outcome, result: result || outcome.result })),
      cancel: h.cancel,
    };
  },
};
