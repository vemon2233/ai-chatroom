import { describe, it, expect, vi } from 'vitest';
import { ChatRoom, makeRoomConfig } from '../src/core/room';
import { MessageBus } from '../src/core/bus';

describe('Scout Lifecycle & Status Broadcasting', () => {
  const dummyCfg = makeRoomConfig({
    name: 'Scout Test Room',
    projectPath: '/dummy/project/path',
    topic: 'Testing scout thinking bubble',
    toolPermission: 'readonly',
    members: [
      { name: 'Agent 1', adapter: 'test-adapter', persona: 'test-persona' },
    ],
  });

  const dummyAdapterConfigs = {
    'test-adapter': { kind: 'echo', command: 'node', args: [] },
    admin: { kind: 'echo', command: 'node', args: [] },
  };

  it('runScout: 在侦察期间广播 thinking 状态，完成后广播 idle 与 done 事件', async () => {
    const bus = new MessageBus();
    const emittedEvents: any[] = [];
    vi.spyOn(bus, 'broadcast').mockImplementation((ev) => {
      emittedEvents.push(ev);
    });

    const room = new ChatRoom(
      dummyCfg,
      bus,
      dummyAdapterConfigs,
      { adapter: 'admin', model: 'echo', timeoutMs: 5000, allowedTools: '', maxRetries: 1 },
      {
        persistRoom: vi.fn().mockResolvedValue(undefined),
        loadMessages: vi.fn().mockResolvedValue([]),
        rewriteMessages: vi.fn().mockResolvedValue(undefined),
        appendMessage: vi.fn().mockResolvedValue(undefined),
      },
      undefined,
      {
        traceStore: {
          saveTrace: vi.fn().mockResolvedValue(undefined),
          getTraceByMessageId: vi.fn().mockResolvedValue(null),
          listTraces: vi.fn().mockResolvedValue([]),
        } as any,
      },
    );

    // mock admin.ensureScout 模拟勘探耗时与输出
    let statusDuringScout = '';
    vi.spyOn((room as any).admin, 'ensureScout').mockImplementation(async () => {
      // 捕获勘探过程中的 room statuses
      statusDuringScout = (room as any).orch.statuses['scout'];
      return {
        id: 'msg_scout_report',
        roomId: dummyCfg.id,
        from: 'scout',
        fromName: '🔍 侦察员',
        text: 'Project architecture scouted successfully.',
        ts: Date.now(),
      };
    });

    // 执行 runScout
    const report = await (room as any).orch.deps.runScout();

    // 1. 勘探过程中状态必须是 thinking
    expect(statusDuringScout).toBe('thinking');

    // 2. 勘探完成后状态必须归位为 idle
    expect((room as any).orch.statuses['scout']).toBe('idle');

    // 3. 必须产出了报告并放入历史
    expect(report).not.toBeNull();
    expect((room as any).messages.some((m: any) => m.id === 'msg_scout_report')).toBe(true);

    // 4. 检查事件广播序列 (agentEvent)
    const scoutAgentEvents = emittedEvents.filter((e) => e.type === 'agentEvent' && e.event.member === 'scout');
    expect(scoutAgentEvents.length).toBe(2);
    expect(scoutAgentEvents[0].event.phase).toBe('thinking');
    expect(scoutAgentEvents[1].event.phase).toBe('done');

    // 5. 检查 roomState statuses 广播包含 scout thinking 和 idle
    const thinkingStates = emittedEvents.filter((e) => e.type === 'roomState' && e.state.statuses?.scout === 'thinking');
    const idleStates = emittedEvents.filter((e) => e.type === 'roomState' && e.state.statuses?.scout === 'idle');
    expect(thinkingStates.length).toBeGreaterThanOrEqual(1);
    expect(idleStates.length).toBeGreaterThanOrEqual(1);
  });
});
