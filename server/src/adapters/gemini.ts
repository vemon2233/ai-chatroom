// ⚠️ experimental:本机未安装 gemini CLI,此适配器零实测;无 trace/session 上报。
// Gemini CLI 适配器:gemini --output-format json(prompt 走 stdin)
// 输出为单个 JSON(无流式事件),进程结束时一次性解析。

import type { AgentAdapter, AgentEvent, SpeakRequest } from './base';
import { runCliHarness, tryParseJson } from './proc';

export const geminiAdapter: AgentAdapter = {
  speak(req: SpeakRequest, onEvent: (ev: AgentEvent) => void) {
    onEvent({ member: req.member, phase: 'thinking' });
    let stdoutAll = '';

    const h = runCliHarness(req, [], {
      // gemini 整段输出一个 JSON:行级不做流式,stdout 收完后统一解析
      onLine: (line) => { stdoutAll += line + '\n'; },
      onStdoutEnd: () => {
        const obj = tryParseJson(stdoutAll.trim());
        if (obj && typeof obj.response === 'string') {
          const usage = obj.usage_metadata
            ? { inputTokens: obj.usage_metadata.prompt_token_count, outputTokens: obj.usage_metadata.candidates_token_count }
            : undefined;
          onEvent({
            member: req.member,
            phase: 'done',
            result: obj.response,
            usage,
          });
          h.settle(); // 已发 done,阻止 close 兜底再发
        }
        // 非结构化:留给 close 兜底(code===0 且有输出 → ok)
      },
    }, onEvent);

    return {
      done: h.done.then((outcome) => ({ ...outcome, result: outcome.result || stdoutAll.trim() })),
      cancel: h.cancel,
    };
  },
};
