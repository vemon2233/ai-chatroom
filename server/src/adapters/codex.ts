// ⚠️ experimental:本机未安装 codex CLI,此适配器(含 resume 路径)零实测。
// Codex CLI 适配器:codex exec --json(prompt 走 stdin)
// session 复用:`codex exec resume <id>`(与常规 exec 前缀互斥,见下方处理)。

import type { ToolPermission } from '../core/types';
import type { AgentAdapter, AgentEvent, SpeakRequest } from './base';
import { runCliHarness, tryParseJson } from './proc';

/** 工具权限档位 → codex CLI 参数(翻译职责在本层) */
function permissionArgs(p: ToolPermission | undefined): string[] {
  switch (p) {
    case 'readwrite': return ['--sandbox', 'workspace-write'];
    case 'full': return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'readonly':
    default: return ['--sandbox', 'read-only'];
  }
}

export const codexAdapter: AgentAdapter = {
  speak(req: SpeakRequest, onEvent: (ev: AgentEvent) => void) {
    // resume 模式为 `codex exec resume <id>`;agents.yaml 的 args 以 exec 开头——resume 时整体替换前缀
    let resumeArgs: string[] = [];
    let args = [...req.args, ...permissionArgs(req.permission)];
    if (req.resumeSessionId) {
      resumeArgs = ['exec', 'resume', req.resumeSessionId];
      if (args[0] === 'exec') args = args.slice(1);
    }
    const creq = { ...req, args };

    onEvent({ member: creq.member, phase: 'thinking' });
    let result = '';

    const h = runCliHarness(creq, resumeArgs, {
      onLine: (line) => {
        const obj = tryParseJson(line);
        if (!obj) {
          // 纯文本行:某些版本把正文直接打到 stdout
          result += line + '\n';
          onEvent({ member: creq.member, phase: 'streaming', textDelta: line + '\n' });
          return;
        }
        const t: string = obj.type ?? '';
        // session id(thread id)上报:thread.started / turn.started 等事件携带
        if (typeof obj.thread_id === 'string' && obj.thread_id) {
          onEvent({ member: creq.member, phase: 'thinking', sessionId: obj.thread_id });
        }
        // 工具调用事件(command execution 等)
        if (Array.isArray(obj.item)) {
          for (const item of obj.item) {
            if (item?.type === 'command_execution' || item?.type === 'function_call') {
              onEvent({
                member: creq.member,
                phase: 'thinking',
                toolUse: {
                  name: item.type,
                  input: JSON.stringify(item.arguments ?? item.command ?? item).slice(0, 2000),
                },
              });
            }
          }
        }
        const msgText: string | undefined =
          obj.message ??
          obj.text ??
          (obj.item?.type === 'agent_message' ? obj.item.text : undefined);
        if (t.includes('completed') || t.includes('message') || t.includes('turn')) {
          if (msgText) {
            result = msgText;
            onEvent({ member: creq.member, phase: 'streaming', textDelta: msgText });
          }
          if (t.includes('turn') && t.includes('completed')) {
            const usage = obj.usage?.input_tokens != null
              ? { inputTokens: obj.usage.input_tokens, outputTokens: obj.usage.output_tokens }
              : undefined;
            onEvent({
              member: creq.member,
              phase: 'done',
              result,
              usage,
            });
            h.settle();
            h.cancel();
          }
        } else if (t === 'error' || obj.error) {
          h.finish(false, String(obj.error?.message ?? obj.error ?? 'Codex 错误'));
        }
      },
    }, onEvent);

    return {
      done: h.done.then((outcome) => ({ ...outcome, result: result || outcome.result })),
      cancel: h.cancel,
    };
  },
};
