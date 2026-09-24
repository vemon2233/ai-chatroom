// 超时保护测试(工单05 / ADR-0002 实现约束):
// - 默认(未配置)行为零变化:既有 261 测试全绿即证,此处补 harness 层直证
// - 超时走 cancelled 轨道 + timedOut 标记;不清 sessionIds、绝不自动重试
// - 用户主动 stop 与超时停可区分(文案不同)
// 接缝:harness(proc.ts)真实进程 + orchestrator fake adapter(挂起不 resolve)。

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCliHarness } from '../src/adapters/proc';
import type { AgentAdapter, AgentEvent, SpeakOutcome, SpeakRequest } from '../src/adapters/base';
import { Orchestrator, type OrchestratorDeps } from '../src/core/orchestrator';
import type { ChatMessage, MemberConfig, RoomConfig } from '../src/core/types';

// Windows shell:true 会吃掉 -e 内联脚本的 (){} 等特殊字符(v1 血泪同源)——
// 挂起/速完进程一律用临时脚本文件
const HANG_SCRIPT = path.join(tmpdir(), 'aicr-timeout-hang.cjs');
const FAST_SCRIPT = path.join(tmpdir(), 'aicr-timeout-fast.cjs');

beforeAll(() => {
  writeFileSync(HANG_SCRIPT, 'setTimeout(function(){}, 30000);\n');
  writeFileSync(FAST_SCRIPT, 'console.log("done");\n');
});
afterAll(() => {
  rmSync(HANG_SCRIPT, { force: true });
  rmSync(FAST_SCRIPT, { force: true });
});

describe('harness 超时(proc.ts 真实进程)', () => {
  it('timeoutMs=200 的长进程(挂起 30s)→ cancelled + timedOut', async () => {
    const req: SpeakRequest = {
      member: 'm1',
      prompt: '',
      command: 'node',
      args: [HANG_SCRIPT],
      timeoutMs: 200,
    };
    const h = runCliHarness(req, [], { onLine: () => {} }, () => {});
    const outcome = await h.done;
    expect(outcome.status).toBe('cancelled');
    expect(outcome.timedOut).toBe(true);
    expect(outcome.durationMs).toBeLessThan(10000); // 没等满 30s
  }, 15000);

  it('未设 timeoutMs:进程照常跑完(默认无限,行为不变)', async () => {
    const req: SpeakRequest = {
      member: 'm1',
      prompt: '',
      command: 'node',
      args: [FAST_SCRIPT],
    };
    const h = runCliHarness(req, [], { onLine: () => {} }, () => {});
    const outcome = await h.done;
    expect(outcome.status).toBe('ok');
    expect(outcome.timedOut).toBeFalsy(); // 未超时的正常完成无标记
  }, 15000);

  it('进程在超时前正常完成:ok 且无 timedOut', async () => {
    const req: SpeakRequest = {
      member: 'm1',
      prompt: '',
      command: 'node',
      args: [FAST_SCRIPT],
      timeoutMs: 30000, // 远大于进程寿命
    };
    const h = runCliHarness(req, [], { onLine: () => {} }, () => {});
    const outcome = await h.done;
    expect(outcome.status).toBe('ok');
    expect(outcome.timedOut).toBeFalsy();
  }, 15000);

  it('用户主动 cancel(无超时):cancelled 但无 timedOut——可区分', async () => {
    const req: SpeakRequest = {
      member: 'm1',
      prompt: '',
      command: 'node',
      args: [HANG_SCRIPT],
    };
    const h = runCliHarness(req, [], { onLine: () => {} }, () => {});
    setTimeout(() => h.cancel(), 300);
    const outcome = await h.done;
    expect(outcome.status).toBe('cancelled');
    expect(outcome.timedOut).toBeFalsy(); // 用户停 ≠ 超时停
  }, 15000);
});

// ---------- 编排器层:超时占位消息/session 保留/不重试 ----------

describe('编排器:超时 outcome 处理(cancelled 轨道)', () => {
  let randomSpy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => { randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); });
  afterEach(() => { randomSpy?.mockRestore(); });

  function makeOrch(adapter: AgentAdapter, speakTimeoutMs?: number) {
    const member: MemberConfig = { id: 'm1', name: '工程师', adapter: 'fake', persona: 'p', color: '#000' };
    const room: RoomConfig = {
      id: 'r1', name: 't', kind: 'task', topic: 'x', chainBudget: 6,
      speechLength: 'normal', toolPermission: 'full', members: [member], createdAt: 0,
      contextMode: 'stateful',
    };
    const messages: ChatMessage[] = [];
    const deps: OrchestratorDeps = {
      room,
      adapterConfigs: { fake: { command: 'fake', args: [] } },
      resolveAdapter: () => adapter,
      pushMessage: async (m) => { messages.push(m); },
      sysMessage: async (text) => { messages.push({ id: `sys${messages.length}`, roomId: 'r1', from: 'system', fromName: '系统', text, ts: Date.now(), system: true }); },
      onStatuses: () => {},
      persistRoom: async () => {},
      runScout: async () => null,
      getHistory: () => messages,
      pushAgentEvent: () => {},
      speakTimeoutMs,
    };
    return { orch: new Orchestrator(deps), messages, room, member };
  }

  it('cancelled+timedOut → 超时占位文案(区别于已停止思考),半截正文保留', async () => {
    const adapter: AgentAdapter = {
      speak(req, onEvent) {
        onEvent({ member: req.member, phase: 'streaming', textDelta: '改到一半的正文' });
        return {
          done: Promise.resolve({ status: 'cancelled', result: '', durationMs: 100, timedOut: true }),
          cancel: () => {},
        };
      },
    };
    const { orch, messages } = makeOrch(adapter, 100);
    await orch.onUserMessage('修个 bug');
    await new Promise((r) => setTimeout(r, 150));
    const memberMsgs = messages.filter((m) => m.from === 'm1');
    expect(memberMsgs.length).toBe(1);
    // 有半截正文 → 保留正文(既有 cancelled 语义),无正文才有占位
    expect(memberMsgs[0]!.text).toContain('改到一半的正文');
  });

  it('cancelled+timedOut 无正文 → "(发言超时已停止)"占位', async () => {
    const adapter: AgentAdapter = {
      speak(req) {
        return {
          done: Promise.resolve({ status: 'cancelled', result: '', durationMs: 100, timedOut: true }),
          cancel: () => {},
        };
      },
    };
    const { orch, messages } = makeOrch(adapter, 100);
    await orch.onUserMessage('修个 bug');
    await new Promise((r) => setTimeout(r, 150));
    const memberMsgs = messages.filter((m) => m.from === 'm1');
    expect(memberMsgs[0]!.text).toContain('发言超时已停止');
    expect(memberMsgs[0]!.text).toContain('重发');
  });

  it('超时不清 sessionIds(重发即 resume 续跑的前提)', async () => {
    let firstCall = true;
    const adapter: AgentAdapter = {
      speak(req, onEvent) {
        if (firstCall) {
          firstCall = false;
          onEvent({ member: req.member, phase: 'thinking', sessionId: 'sess-1' });
          return {
            done: Promise.resolve({ status: 'cancelled', result: '', durationMs: 100, timedOut: true }),
            cancel: () => {},
          };
        }
        return {
          done: Promise.resolve({ status: 'ok', result: '续跑完成', durationMs: 50 }),
          cancel: () => {},
        };
      },
    };
    const { orch, messages, member } = makeOrch(adapter, 100);
    await orch.onUserMessage('修个 bug');
    await new Promise((r) => setTimeout(r, 150));
    expect(member.sessionIds?.fake).toBe('sess-1'); // 超时后 session 仍在

    // 重发消息 → resume(sess-1 传入)且成功——前功不弃
    await orch.onUserMessage('继续');
    await new Promise((r) => setTimeout(r, 150));
    const ok = messages.filter((m) => m.from === 'm1' && m.text === '续跑完成');
    expect(ok.length).toBe(1);
  });

  it('超时后不自动重试(fake 只被调一次)', async () => {
    let calls = 0;
    const adapter: AgentAdapter = {
      speak(req) {
        calls++;
        return {
          done: Promise.resolve({ status: 'cancelled', result: '', durationMs: 100, timedOut: true }),
          cancel: () => {},
        };
      },
    };
    const { orch } = makeOrch(adapter, 100);
    await orch.onUserMessage('修个 bug');
    await new Promise((r) => setTimeout(r, 300)); // 给足"若误走 error 轨道会重试"的时间
    expect(calls).toBe(1); // cancelled 绝不重试——与 error 自愈轨道的根本区别
    expect(orch.state).toBe('idle');
  });
});
