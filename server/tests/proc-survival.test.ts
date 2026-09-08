// proc.ts 进程 harness 生存性测试(Windows 实测语义)。
// spawnCli/runCliHarness 涉及真实子进程,测试仅验证"恶劣条件下 server 不崩"这一条不变量。

import { describe, it, expect } from 'vitest';
import { runCliHarness } from '../src/adapters/proc';
import type { SpeakRequest } from '../src/adapters/base';

describe('proc harness:EPIPE 生存性', () => {
  it('CLI 秒退 + 超大 prompt:stdin EPIPE 不击穿进程,outcome 判定为 error', async () => {
    // shell:true 下 cmd.exe 存在,shell 内命令解析失败 → 进程立即退出 code≠0;
    // 与此同时超大 prompt 的异步 flush 落在已关管道 → EPIPE。
    // 修复前:无 stdin error 监听 → uncaughtException → 测试进程直接崩(测试永远到不了断言)
    const bigPrompt = 'x'.repeat(2 * 1024 * 1024); // 2MB,远超管道缓冲
    const req: SpeakRequest = {
      member: 'm1',
      prompt: bigPrompt,
      command: 'definitely-not-a-real-command-xyz',
      args: [],
    };

    const harness = runCliHarness(req, [], { onLine: () => {} }, () => {});
    const outcome = await harness.done;

    expect(['error', 'cancelled']).toContain(outcome.status); // 绝不是 ok
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0); // 到这里 = 进程没崩
  }, 15000);
});
