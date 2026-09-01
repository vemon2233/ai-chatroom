// Claude Code 适配器:claude -p --output-format stream-json --verbose(prompt 走 stdin)
// 已实测:system/init(含 session_id)→ system/thinking_tokens →
// assistant(text/thinking/tool_use 块)→ user(tool_result)→ result。
// session 复用:首话上报 session_id,后续发言 --resume <id>。

import type { ToolPermission } from '../core/types';
import type { AgentAdapter, AgentEvent, SpeakRequest } from './base';
import { runCliHarness, tryParseJson } from './proc';

/** 工具权限档位 → claude CLI 参数(领域枚举的翻译职责在本层,v1 曾错误地放在 core) */
function permissionArgs(p: ToolPermission | undefined): string[] {
  switch (p) {
    case 'readwrite':
      return ['--allowedTools', 'Read Write Edit Glob Grep'];
    case 'full':
      return []; // 不限制
    case 'readonly':
    default:
      return ['--allowedTools', 'Read Glob Grep'];
  }
}

export const claudeAdapter: AgentAdapter = {
  speak(req: SpeakRequest, onEvent: (ev: AgentEvent) => void) {
    const resumeArgs = req.resumeSessionId
      ? ['--resume', req.resumeSessionId]
      : [];
    // 权限翻译在适配器内完成,core 只传领域枚举
    const args = [...req.args, ...permissionArgs(req.permission)];

    onEvent({ member: req.member, phase: 'thinking' });
    let result = '';

    const h = runCliHarness({ ...req, args }, resumeArgs, {
      onLine: (line) => {
        const obj = tryParseJson(line);
        if (!obj) return; // 非事件行(如警告),忽略

        if (obj.type === 'system' && obj.subtype === 'init') {
          if (obj.session_id) {
            onEvent({ member: req.member, phase: 'thinking', sessionId: obj.session_id });
          }
        } else if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
          for (const block of obj.message.content) {
            if (block.type === 'text' && block.text) {
              result += block.text;
              onEvent({ member: req.member, phase: 'streaming', textDelta: block.text });
            } else if (block.type === 'thinking' && block.thinking) {
              onEvent({ member: req.member, phase: 'thinking', thinkingDelta: block.thinking });
            } else if (block.type === 'tool_use') {
              onEvent({
                member: req.member,
                phase: 'thinking',
                toolUse: {
                  name: block.name ?? 'unknown_tool',
                  input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
                },
              });
            }
          }
        } else if (obj.type === 'user' && Array.isArray(obj.message?.content)) {
          // tool_result 块挂在 user 消息里
          for (const block of obj.message.content) {
            if (block.type === 'tool_result') {
              const content = block.content;
              const text = typeof content === 'string'
                ? content
                : Array.isArray(content)
                  ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
                  : '';
              onEvent({
                member: req.member,
                phase: 'thinking',
                toolResult: {
                  name: block.tool_use_id ? `tool:${String(block.tool_use_id).slice(-8)}` : 'tool',
                  output: text.slice(0, 2000), // 截断防爆 detail
                },
              });
            }
          }
        } else if (obj.type === 'system' && obj.subtype === 'thinking_tokens') {
          if (typeof obj.text === 'string' && obj.text) {
            onEvent({ member: req.member, phase: 'thinking', thinkingDelta: obj.text });
          }
        } else if (obj.type === 'result') {
          if (obj.is_error) {
            h.finish(false, obj.result ?? 'Claude CLI 返回错误');
            return;
          }
          // result 事件的 result 字段是最终全文(权威,覆盖累积值)
          if (typeof obj.result === 'string') result = obj.result;
          const usage = obj.usage
            ? {
                inputTokens: obj.usage.input_tokens,
                outputTokens: obj.usage.output_tokens,
                costUsd: obj.total_cost_usd,
              }
            : undefined;
          onEvent({
            member: req.member,
            phase: 'done',
            result,
            usage,
            sessionId: obj.session_id,
          });
          h.settle(); // 已发 done,阻止 close 兜底再发
          h.cancel(); // 拿到 result 即终止(进程通常也自行退出,双保险)
        }
      },
    }, onEvent);

    return {
      done: h.done.then((outcome) => ({ ...outcome, result: result || outcome.result })),
      cancel: h.cancel,
    };
  },
};
