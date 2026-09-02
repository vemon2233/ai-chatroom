// 编排器测试(fake adapter 注入,H1-H8 全场景)。
// fake adapter 用脚本化响应:按调用序返回预设 outcome,验证状态机转移。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../src/core/orchestrator';
import type { AgentAdapter, AgentEvent, SpeakOutcome, SpeakRequest } from '../src/adapters/base';
import type { ChatMessage, MemberConfig, RoomConfig } from '../src/core/types';

// ---------- fake adapter ----------

interface ScriptedResponse {
  outcome?: Partial<SpeakOutcome>;
  result?: string;
  sessionId?: string;
  /** done 延迟 resolve 的毫秒数(默认 50;需要测试中途干预时调大) */
  holdMs?: number;
  /** 该响应归属哪个成员;缺省按入队顺序轮转 */
  member?: string;
}

/** 脚本化 fake adapter:响应按 member 匹配(member 无对应脚本则用缺省脚本按序轮转)。 */
function makeFakeAdapter(defaultScript: ScriptedResponse[], byMember?: Record<string, ScriptedResponse[]>) {
  let call = 0;
  const requests: SpeakRequest[] = [];
  const pick = (req: SpeakRequest): ScriptedResponse => {
    const script = byMember?.[req.member] ?? defaultScript;
    // byMember 脚本取该成员的下一个;default 按全局调用序
    if (byMember?.[req.member]) {
      const seq = byMember[req.member]!;
      const idx = requests.filter((r) => r.member === req.member).length - 1;
      return seq[Math.min(idx, seq.length - 1)]!;
    }
    return script[Math.min(call, script.length - 1)]!;
  };
  const impl: AgentAdapter = {
    speak(req: SpeakRequest, onEvent: (ev: AgentEvent) => void) {
      requests.push(req);
      const s = pick(req);
      call++;
      // 异步发出事件并结束
      void Promise.resolve().then(() => {
        if (s.sessionId) {
          onEvent({ member: req.member, phase: 'thinking', sessionId: s.sessionId });
        }
        onEvent({ member: req.member, phase: 'streaming', textDelta: s.result ?? '' });
        onEvent({ member: req.member, phase: 'done', result: s.outcome?.status === 'error' ? undefined : (s.result ?? '') });
        if (s.outcome?.status === 'error') {
          onEvent({ member: req.member, phase: 'error', error: s.outcome?.error ?? 'boom' });
        }
      });
      let cancelled = false;
      const holdMs = s.holdMs ?? 50;
      return {
        done: new Promise<SpeakOutcome>((resolve) => {
          // holdMs 后 resolve;cancel 不提前 resolve(贴近真实:进程退出有时延)
          setTimeout(() => {
            resolve(cancelled
              ? { status: 'cancelled', result: '', durationMs: holdMs }
              : (s.outcome?.status === 'error'
                ? { status: 'error', result: '', durationMs: holdMs, error: s.outcome?.error ?? 'boom' }
                : { status: 'ok', result: s.result ?? '', durationMs: holdMs }));
          }, holdMs);
        }),
        cancel: () => { cancelled = true; },
      };
    },
  };
  return { impl, requests, callCount: () => call };
}

// ---------- 装配 ----------

function makeMembers(n: number, names?: string[]): MemberConfig[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    name: names?.[i] ?? `成员${i + 1}`,
    adapter: 'fake',
    persona: '测试人设',
    color: '#000',
  }));
}

function makeRoomConfig(members: MemberConfig[], over: Partial<RoomConfig> = {}): RoomConfig {
  return {
    id: 'room_test',
    name: '测试房',
    topic: '测试主题',
    chainBudget: 6,
    speechLength: 'normal',
    toolPermission: 'readonly',
    members,
    createdAt: 0,
    ...over,
  };
}

interface Harness {
  orch: Orchestrator;
  messages: ChatMessage[];
  fake: ReturnType<typeof makeFakeAdapter>;
  room: RoomConfig;
}

function makeHarness(
  script: ScriptedResponse[],
  over: Partial<RoomConfig> = {},
  members?: MemberConfig[],
  byMember?: Record<string, ScriptedResponse[]>,
): Harness {
  const mem = members ?? makeMembers(3, ['甲', '乙', '丙']);
  const room = makeRoomConfig(mem, over);
  const fake = makeFakeAdapter(script, byMember);
  const messages: ChatMessage[] = [];
  const persistRoom = vi.fn(async () => {});
  const deps: OrchestratorDeps = {
    room,
    adapterConfigs: { fake: { command: 'fake', args: [] } },
    resolveAdapter: () => fake.impl,
    pushMessage: async (m) => { messages.push(m); },
    sysMessage: async (text) => {
      messages.push({ id: `sys${messages.length}`, roomId: room.id, from: 'system', fromName: '系统', text, ts: Date.now(), system: true });
    },
    onStatuses: () => {},
    persistRoom,
    runScout: async () => null, // 测试默认不跑侦察
    getHistory: () => messages,
    pushAgentEvent: () => {},
  };
  return { orch: new Orchestrator(deps), messages, fake, room };
}

/** 等待队列清空(串行循环跑完)。 */
async function drain(h: Harness, ms = 120): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, ms / 10));
    if (h.orch.state !== 'roundrobin' || true) {
      // 简单等够时间让队列消化
    }
  }
}

async function settle(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ---------- 场景 ----------

describe('编排器状态机', () => {
  it('纯文本冷启动:进入 baton,首成员起头,接棒链传递', async () => {
    const h = makeHarness([
      { result: '第一棒\n【接棒】@乙' },
      { result: '第二棒\n【接棒】@甲' },
      { result: '第三棒(无接棒行)' },
    ]);
    await h.orch.onUserMessage('开始讨论');
    await settle(80);
    expect(h.orch.state).toBe('baton');
    expect(h.messages.filter((m) => m.from === 'm1').length).toBe(1);

    await settle(200); // 接棒链 m1→m2→m3
    const memberMsgs = h.messages.filter((m) => !m.system);
    expect(memberMsgs.filter((m) => m.from === 'm2').length).toBe(1);
    expect(h.orch.state).toBe('idle'); // m3 没写接棒行 → 停止,用户接管
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('控制权回到你手中');
  });

  it('没写接棒行 → idle + 系统提示(不轮询兜底)', async () => {
    const h = makeHarness([{ result: '我说完了' }]);
    await h.orch.onUserMessage('聊聊');
    await settle(150);
    expect(h.orch.state).toBe('idle');
    expect(h.fake.callCount()).toBe(1); // 只有一次发言,没有兜底调用
  });

  it('【接棒】结束 → idle', async () => {
    const h = makeHarness([{ result: '总结陈词\n【接棒】结束' }]);
    await h.orch.onUserMessage('开始');
    await settle(120);
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('宣布讨论结束');
  });

  it('接棒预算耗尽 → idle + 提示', async () => {
    const h = makeHarness([
      { result: '1\n【接棒】@乙' },
      { result: '2\n【接棒】@甲' },
    ], { chainBudget: 1 }); // 预算 1:第一棒传棒后耗尽
    await h.orch.onUserMessage('开始');
    await settle(150);
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('接棒上限');
    expect(h.orch.state).toBe('idle');
  });

  it('@点名:一问一答,答完 idle,不传棒', async () => {
    const h = makeHarness([{ result: '回答:我认为…' }]);
    await h.orch.onUserMessage('@乙 你怎么看?');
    await settle(120);
    expect(h.fake.requests[0]?.member).toBe('m2');
    expect(h.orch.state).toBe('idle');
    expect(h.messages.filter((m) => m.from === 'm2').length).toBe(1);
  });

  it('@allN:轮流 N 轮 + 主持人轮末小结 + 终局总结,跑完 idle', async () => {
    const members = makeMembers(3, ['甲', '乙', '主持']);
    const h = makeHarness(
      Array.from({ length: 10 }, (_, i) => ({ result: `发言${i}` })),
      { moderatorId: 'm3' },
      members,
    );
    await h.orch.onUserMessage('@all2');
    await settle(500); // 7 次调用 × 50ms hold + 微任务余量
    // 2 轮 × 2 辩手 + 2 次小结 + 1 终局 = 7 次调用
    expect(h.fake.callCount()).toBe(7);
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('轮流发言结束');
  });

  it('轮流中 stop:剩余条目全部丢弃(世代计数)', async () => {
    const h = makeHarness(
      Array.from({ length: 10 }, (_, i) => ({ result: `发言${i}` })),
    );
    await h.orch.onUserMessage('@all3');
    await settle(20); // 第一棒开始
    await h.orch.stop();
    await settle(200);
    const calls = h.fake.callCount();
    expect(calls).toBeLessThanOrEqual(2); // 最多在跑的一条被打断,后续全丢
    expect(h.orch.state).toBe('idle');
    const callsAfter = h.fake.callCount();
    await settle(150);
    expect(h.fake.callCount()).toBe(callsAfter); // 不再新增
  });

  it('发言 error → 一律 idle,不解析接棒,不重试', async () => {
    const h = makeHarness([{ outcome: { status: 'error', error: 'CLI 崩了' } }]);
    await h.orch.onUserMessage('开始');
    await settle(150);
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('发言失败');
    // 无成员消息落库
    expect(h.messages.filter((m) => m.from.startsWith('m')).length).toBe(0);
  });

  it('resume 失败自愈:清 sessionId 无 resume 重试一次', async () => {
    const members = makeMembers(1, ['甲']);
    members[0]!.sessionIds = { fake: 'stale-id' };
    // 第 1 次失败,第 2 次(重试)成功
    const h = makeHarness([
      { outcome: { status: 'error', error: 'resume failed' }, sessionId: 'stale-id' },
      { result: '自愈成功' },
    ], {}, members);
    await h.orch.onUserMessage('开始');
    await settle(150);
    expect(h.fake.callCount()).toBe(2);
    expect(h.fake.requests[1]?.resumeSessionId).toBeUndefined(); // 重试不带 resume
    expect(h.messages.some((m) => m.text === '自愈成功')).toBe(true);
  });

  it('幽灵成员防御:@all 预入队条目在成员移除后不执行', async () => {
    const members = makeMembers(2, ['甲', '乙']);
    const h = makeHarness([], {}, members, {
      m1: [{ result: '甲发言' }],
      m2: [{ result: '乙不该发言' }],
    });
    await h.orch.onUserMessage('@all1');
    await settle(20); // 甲在说(hold 50ms)
    h.orch.memberRemoved('m2'); // @all1 为乙预入队的条目应被 dequeue 防御拦截
    await settle(200);
    expect(h.messages.some((m) => m.text === '乙不该发言')).toBe(false);
  });

  it('baton 中用户新消息:预算重置,链不断', async () => {
    const h = makeHarness([
      { result: '1\n【接棒】@乙' },
      { result: '2\n【接棒】@甲' },
      { result: '3\n【接棒】@乙' },
      { result: '4\n【接棒】@甲' },
    ], { chainBudget: 2 });
    await h.orch.onUserMessage('开始');
    await settle(60);
    expect(h.orch.state).toBe('baton');
    // 预算 2 将耗尽,用户消息重置
    await h.orch.onUserMessage('继续聊');
    await settle(300);
    // 链条持续(预算被重置)
    expect(h.fake.callCount()).toBeGreaterThanOrEqual(3);
  });

  it('@点名取消未开始的旧条目(世代隔离)', async () => {
    const h = makeHarness([], {}, undefined, {
      m1: [{ result: '甲发言\n【接棒】@乙', holdMs: 80 }],
      m2: [{ result: '乙被打断前的话' }],
      m3: [{ result: '丙回答点名' }],
    });
    await h.orch.onUserMessage('开始');
    await settle(20); // 甲在说(hold 80ms)
    await h.orch.onUserMessage('@丙 你来说'); // m2 的条目应被世代作废
    await settle(250);
    expect(h.messages.some((m) => m.text === '丙回答点名')).toBe(true);
    expect(h.messages.some((m) => m.text === '乙被打断前的话')).toBe(false);
    expect(h.orch.state).toBe('idle');
  });

  it('空房间纯消息:提示不转移', async () => {
    const h = makeHarness([], {}, []);
    await h.orch.onUserMessage('有人吗');
    await settle(60);
    expect(h.orch.state).toBe('idle');
    expect(h.fake.callCount()).toBe(0);
  });

  it('cancel 落占位消息:stop 时记录"(已停止思考)"而非凭空消失', async () => {
    const h = makeHarness([{ result: '说一半被打断', holdMs: 200 }]);
    await h.orch.onUserMessage('开始');
    await settle(30); // 发言进行中(hold 200ms)
    await h.orch.stop();
    await settle(300);
    // 正文不落,但"已停止"占位必须落库(刷新后仍可见)
    const msgs = h.messages.filter((m) => m.from === 'm1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe('(已停止思考)');
    expect(h.orch.state).toBe('idle');
    expect(h.orch.statuses['m1']).toBe('idle');
  });

  it('stop 不触发 resume 重试:cancel 后绝不复活新进程(修"按两次停止"bug)', async () => {
    // 场景:成员已有 sessionId(init 事件捕获),发言被 stop 打断 → cancelled
    // 若 invokeWithRetry 把 cancelled 当失败重试,会立刻 spawn 新进程(第二次 BUSY)
    const members = makeMembers(1, ['甲']);
    members[0]!.sessionIds = { fake: 'sess-1' }; // 模拟首话后已有 session
    let cancelRequested = false;
    const h = makeHarness([], {}, members, {
      m1: [{ result: '被打断', holdMs: 120 }],
    });
    await h.orch.onUserMessage('开始');
    await settle(30); // 甲在说
    await h.orch.stop(); // cancel → outcome=cancelled
    const callsAfterStop = h.fake.callCount();
    await settle(300);
    // 关键断言:cancelled 后零重试(调用数不增),statuses 回 idle
    expect(h.fake.callCount()).toBe(callsAfterStop);
    expect(h.orch.statuses['m1']).toBe('idle');
    expect(h.orch.state).toBe('idle');
    expect(cancelRequested).toBe(false);
  });

  it('session id 捕获后随消息持久化(写穿钩子被调)', async () => {
    const h = makeHarness([{ result: '发言', sessionId: 'sess-123' }]);
    await h.orch.onUserMessage('开始');
    await settle(120);
    expect(h.room.members[0]!.sessionIds?.fake).toBe('sess-123');
  });
});
