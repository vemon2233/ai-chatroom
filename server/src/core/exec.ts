// 底层通用执行基建: 一次性轻量 CLI 探针调用。
// 适用场景: Scout 侦察、意愿自评打分、以及未来的讨论摘要。
// 特性: 超时必定 clearTimeout + cancel 进程(彻底杜绝定时器泄漏与孤儿进程)。

import type { AgentAdapter, SpeakOutcome, SpeakRequest } from '../adapters/base';

/**
 * 一次性轻量调用: 超时必 clearTimeout + cancel 进程。
 * @param req 发言请求
 * @param adapter 适配器实例
 * @param timeoutMs 超时毫秒数
 */
export async function oneShotSpeak(
  req: SpeakRequest,
  adapter: AgentAdapter,
  timeoutMs: number,
): Promise<SpeakOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const handle = adapter.speak(req, () => {
      // 一次性调用不消费事件流
    });
    const timeout = new Promise<SpeakOutcome>((resolve) => {
      timer = setTimeout(() => {
        handle.cancel(); // 超时必杀进程, 不养孤儿
        resolve({
          status: 'error',
          result: '',
          durationMs: timeoutMs,
          error: `超时(${timeoutMs}ms)`,
        });
      }, timeoutMs);
    });
    const outcome = await Promise.race([handle.done, timeout]);
    return outcome;
  } finally {
    if (timer != null) clearTimeout(timer); // 无论谁赢, 定时器必清
  }
}
