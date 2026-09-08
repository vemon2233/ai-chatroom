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

describe('proc harness:stderr 诊断透传', () => {
  it('命令不存在时,stderr 尾部拼进 error 消息(可直接读出失败原因)', async () => {
    // Windows 中文 cmd:'xxx' 不是内部或外部命令 → 修复前只报"进程退出(code=1)",
    // 定位全靠猜;修复后 stderr 尾行直接可见
    const req: SpeakRequest = {
      member: 'm1',
      prompt: 'hi',
      command: 'definitely-not-a-real-command-xyz',
      args: [],
    };
    const harness = runCliHarness(req, [], { onLine: () => {} }, () => {});
    const outcome = await harness.done;

    expect(outcome.status).toBe('error');
    expect(outcome.error).toMatch(/进程退出\(code=\d+\)/);
    // 命令名必须出现在 error 里(cmd 报错回显了它;兼容中英文 cmd 文案)
    expect(outcome.error).toContain('definitely-not-a-real-command-xyz');
  }, 15000);

  it('正常成功进程:stderr 无内容,error 不拼接', async () => {
    // echo 经 cmd shell 成功退出 code=0,stderr 空 → ok,无 error 字段
    const req: SpeakRequest = {
      member: 'm1',
      prompt: '',
      command: 'echo',
      args: ['hello-proc-test'],
    };
    const harness = runCliHarness(req, [], { onLine: () => {} }, () => {});
    const outcome = await harness.done;

    expect(outcome.status).toBe('ok');
    expect(outcome.error).toBeUndefined();
  }, 15000);
});
