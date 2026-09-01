// 通用模板适配器:任何"接收 prompt、输出文本"的 CLI。
// agents.yaml 里配 kind: generic 即可接入(DeepSeek harness、本地脚本、curl 调 API 等)。

import type { AgentAdapter, AgentEvent, SpeakRequest } from './base';
import { runCliHarness } from './proc';

export const genericAdapter: AgentAdapter = {
  speak(req: SpeakRequest, onEvent: (ev: AgentEvent) => void) {
    let result = '';
    onEvent({ member: req.member, phase: 'thinking' });

    const h = runCliHarness(req, [], {
      // 通用 CLI:每行 stdout 都是正文增量
      onLine: (line) => {
        result += line + '\n';
        onEvent({ member: req.member, phase: 'streaming', textDelta: line + '\n' });
      },
    }, onEvent);

    return {
      done: h.done.then((outcome) => ({ ...outcome, result: result || outcome.result })),
      cancel: h.cancel,
    };
  },
};
