// 编排器测试(fake adapter 注入,状态机全场景)。
// fake adapter 用脚本化响应:按调用序返回预设 outcome,验证状态机转移。
// Math.random 统一 mock(冷启动随机的确定性):beforeEach 置 spy=0.0 → 永远选第一位。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  /** 只发 thinking 不发 streaming(模拟纯思考阶段被 stop) */
  noStream?: boolean;
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
        onEvent({ member: req.member, phase: 'thinking', thinkingDelta: '想了很多…' });
        if (!s.noStream) {
          onEvent({ member: req.member, phase: 'streaming', textDelta: s.result ?? '' });
          onEvent({ member: req.member, phase: 'done', result: s.outcome?.status === 'error' ? undefined : (s.result ?? '') });
        }
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
  savedTraces: any[];
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
  const savedTraces: any[] = [];
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
    saveTrace: async (_scope, _id, trace) => { savedTraces.push(trace); },
  };
  return { orch: new Orchestrator(deps), messages, fake, room, savedTraces };
}

async function settle(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// Math.random mock:返回 0 → 冷启动随机永远选中 members[0](m1/甲)
let randomSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  randomSpy?.mockRestore();
});

// ---------- 场景 ----------

describe('编排器状态机:接棒链', () => {
  it('纯文本冷启动:无待命者 → 随机起头(mock=0 → m1),链传递', async () => {
    const h = makeHarness([
      { result: '第一棒\n<接棒>@乙' },
      { result: '第二棒\n<接棒>@甲' },
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
    expect(sys).toContain('随机选中'); // 冷启动随机提示
  });

  it('冷启动随机真的随机分布(mock 变化 → 不同成员)', async () => {
    const h = makeHarness([], {}, undefined, {
      m1: [{ result: '甲' }], m2: [{ result: '乙' }], m3: [{ result: '丙' }],
    });
    randomSpy?.mockReturnValue(0.5); // floor(0.5*3)=1 → m2
    await h.orch.onUserMessage('开始');
    await settle(120);
    expect(h.fake.requests[0]?.member).toBe('m2');
  });

  it('没写接棒行 → idle + 提示(不轮询兜底)', async () => {
    const h = makeHarness([{ result: '我说完了' }]);
    await h.orch.onUserMessage('聊聊');
    await settle(150);
    expect(h.orch.state).toBe('idle');
    expect(h.fake.callCount()).toBe(1); // 只有一次发言,没有兜底调用
  });

  it('<接棒>结束 → idle', async () => {
    const h = makeHarness([{ result: '总结陈词\n<接棒>结束' }]);
    await h.orch.onUserMessage('开始');
    await settle(120);
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('宣布讨论结束');
  });

  it('接棒预算耗尽 → idle + 提示(指定者转待命)', async () => {
    const h = makeHarness([
      { result: '1\n<接棒>@乙' },
      { result: '2\n<接棒>@甲' },
    ], { chainBudget: 1 }); // 预算 1:第一棒传棒后耗尽
    await h.orch.onUserMessage('开始');
    await settle(150);
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('接棒上限');
    expect(h.orch.state).toBe('idle');
    // 预算耗尽:被指定的甲进入待命,下次纯文本消息 TA 起头
    randomSpy?.mockReturnValue(0.99); // 若无待命者会选 m3;有待命者应仍选 m1
    await h.orch.onUserMessage('继续');
    await settle(120);
    expect(h.fake.requests[2]?.member).toBe('m1');
  });

  it('旧语法【接棒】仍解析(resume 旧 session 记忆惯性)', async () => {
    const h = makeHarness([
      { result: '旧格式\n【接棒】@乙' },
      { result: '乙收到了' },
    ]);
    await h.orch.onUserMessage('开始');
    await settle(250);
    expect(h.messages.some((m) => m.text === '乙收到了')).toBe(true);
  });
});

describe('编排器状态机:@点名 → 待命接棒', () => {
  it('点名:回应 + <接棒>指定下一位 → 暂停待命(不自动发言)', async () => {
    const h = makeHarness([], {}, undefined, {
      m2: [{ result: '回答:我认为…\n<接棒>@丙' }],
      m3: [{ result: '丙不该自动发言' }],
    });
    await h.orch.onUserMessage('@乙 你怎么看?');
    await settle(150);
    expect(h.fake.requests[0]?.member).toBe('m2');
    expect(h.messages.some((m) => m.text === '丙不该自动发言')).toBe(false); // 关键:暂停
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('你发消息后 TA 开始发言'); // 待命提示
  });

  it('待命者:用户纯文本消息后起头进链', async () => {
    const h = makeHarness([], {}, undefined, {
      m2: [{ result: '回答\n<接棒>@丙' }],
      m3: [{ result: '丙起头\n<接棒>结束' }],
    });
    await h.orch.onUserMessage('@乙 你怎么看?');
    await settle(150);
    randomSpy?.mockReturnValue(0.99); // 若无待命者随机会选 m3 之外……floor(0.99*3)=2 → 也是 m3;改 0(→m1)更严格
    randomSpy?.mockReturnValue(0);    // 无待命者会选 m1;有待命者必须仍选 m3
    await h.orch.onUserMessage('继续吧');
    await settle(150);
    expect(h.fake.requests[1]?.member).toBe('m3'); // 丙(待命者)起头,而非随机 m1
    expect(h.messages.some((m) => m.text.startsWith('丙起头'))).toBe(true); // chain 保留接棒行
  });

  it('点名后没写接棒行 → 无待命者,纯文本走随机', async () => {
    const h = makeHarness([], {}, undefined, {
      m2: [{ result: '我回答完了,不指定' }],
      m1: [{ result: '甲随机起头' }],
    });
    await h.orch.onUserMessage('@乙 说说');
    await settle(150);
    await h.orch.onUserMessage('继续');
    await settle(150);
    expect(h.fake.requests[1]?.member).toBe('m1'); // mock=0 → m1
  });

  it('待命者被移除 → 作废,纯文本走随机', async () => {
    const h = makeHarness([], {}, undefined, {
      m2: [{ result: '回答\n<接棒>@丙' }],
      m1: [{ result: '甲兜底起头' }],
    });
    await h.orch.onUserMessage('@乙 说');
    await settle(150);
    h.orch.memberRemoved('m3'); // 丙(待命者)被移除
    await h.orch.onUserMessage('继续');
    await settle(150);
    expect(h.fake.requests[1]?.member).toBe('m1'); // 不崩溃,回退随机
  });

  it('@点名取消未开始的旧条目(世代隔离)', async () => {
    const h = makeHarness([], {}, undefined, {
      m1: [{ result: '甲发言\n<接棒>@乙', holdMs: 80 }],
      m2: [{ result: '乙被打断前的话' }],
      m3: [{ result: '丙回应点名' }],
    });
    await h.orch.onUserMessage('开始');
    await settle(20); // 甲在说(hold 80ms)
    await h.orch.onUserMessage('@丙 你来说'); // m2 的条目应被世代作废
    await settle(250);
    expect(h.messages.some((m) => m.text === '丙回应点名')).toBe(true);
    expect(h.messages.some((m) => m.text === '乙被打断前的话')).toBe(false);
    expect(h.orch.state).toBe('idle');
  });
});

describe('编排器状态机:<接棒> 用户指令', () => {
  it('用户 <接棒>@xx → xx 直接起头进链(不等下一条消息)', async () => {
    const h = makeHarness([
      { result: '我起头\n<接棒>@乙' },
      { result: '乙接棒\n<接棒>结束' },
    ]);
    await h.orch.onUserMessage('<接棒>@丙 从你开始');
    await settle(60); // 丙在说(hold 50ms)期间链就应为 baton
    expect(h.fake.requests[0]?.member).toBe('m3'); // 指定丙,不是随机 m1
    expect(h.orch.state).toBe('baton');
    await settle(260);
    expect(h.messages.some((m) => m.text.startsWith('乙接棒'))).toBe(true); // 链继续;乙 <接棒>结束 → idle
    expect(h.orch.state).toBe('idle');
  });

  it('用户旧语法【接棒】@xx 同样生效', async () => {
    const h = makeHarness([{ result: '起头' }]);
    await h.orch.onUserMessage('【接棒】@乙 开始');
    await settle(120);
    expect(h.fake.requests[0]?.member).toBe('m2');
  });

  it('<接棒>@不存在 → 不误触发点名,按纯文本随机', async () => {
    const h = makeHarness([{ result: '随机起头' }]);
    await h.orch.onUserMessage('<接棒>@不存在的人 开始');
    await settle(120);
    expect(h.fake.requests[0]?.member).toBe('m1'); // mock=0 → 随机 m1
  });
});

describe('编排器状态机:@allN 轮流', () => {
  it('轮流 N 轮跑完 idle(无额外总结发言)', async () => {
    const members = makeMembers(2, ['甲', '乙']);
    const h = makeHarness(
      Array.from({ length: 10 }, (_, i) => ({ result: `发言${i}` })),
      {},
      members,
    );
    await h.orch.onUserMessage('@all2');
    await settle(500);
    // 2 轮 × 2 成员 = 4 次调用
    expect(h.fake.callCount()).toBe(4);
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('轮流发言结束');
  });

  it('轮流中的发言剥掉接棒行(非链上不保留标记)', async () => {
    const h = makeHarness([{ result: '轮流发言\n<接棒>@乙' }]);
    await h.orch.onUserMessage('@all1');
    await settle(150);
    const memberMsgs = h.messages.filter((m) => m.from === 'm1');
    expect(memberMsgs).toHaveLength(1);
    expect(memberMsgs[0]!.text).not.toContain('<接棒>'); // 已剥
    expect(memberMsgs[0]!.text).toContain('轮流发言');
  });

  it('@all 词边界:不吞 "all" 开头的成员名(@allan 走点名,不再误触发轮流)', async () => {
    const members = makeMembers(2, ['allan', '乙']);
    const h = makeHarness(
      [{ result: '我是 allan' }, { result: '补一句' }],
      {},
      members,
    );
    await h.orch.onUserMessage('@allan 说说看');
    await settle(120);
    // 点名语义:仅 allan(m1) 被唤醒一次,不是全员轮流,更不是 N 轮
    expect(h.orch.state).not.toBe('roundrobin');
    const speakers = h.fake.requests.map((r) => r.member);
    expect(speakers.filter((s) => s === 'm1').length).toBe(1);
    expect(speakers).not.toContain('m2');
  });

  it('@all 空格轮数(@all 2)与紧贴轮数(@all3)都正常命中轮流', async () => {
    const h = makeHarness(Array.from({ length: 12 }, (_, i) => ({ result: `s${i}` })));
    await h.orch.onUserMessage('@all 1');
    await settle(400);
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('轮流发言 1 轮'); // 空格形态轮数被解析
    expect(h.fake.callCount()).toBe(3); // 3 成员 × 1 轮
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
});

describe('编排器状态机:错误与取消', () => {
  it('发言 error → 一律 idle,不解析接棒,不重试', async () => {
    const h = makeHarness([{ outcome: { status: 'error', error: 'CLI 崩了' } }]);
    await h.orch.onUserMessage('开始');
    await settle(150);
    expect(h.orch.state).toBe('idle');
    const sys = h.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('发言失败');
    // 无成员消息落库
    expect(h.messages.filter((m) => m.from.startsWith('m')).length).toBe(0);
    // 失败调用也落 trace:错误原文与命令快照是排查命脉(修 bug:此前 error 路径不落 trace)
    expect(h.savedTraces.length).toBe(1);
    expect(h.savedTraces[0].status).toBe('error');
    expect(h.savedTraces[0].error).toBe('CLI 崩了');
    expect(h.savedTraces[0].input.command).toBe('fake');
  });

  it('resume 失败自愈:清 sessionId 无 resume 重试一次', async () => {
    const members = makeMembers(1, ['甲']);
    members[0]!.sessionIds = { fake: 'stale-id' };
    // 第 1 次失败,第 2 次(重试)成功
    const h = makeHarness([
      { outcome: { status: 'error', error: 'resume failed' }, sessionId: 'stale-id' },
      { result: '自愈成功' },
    ], { contextMode: 'stateful' }, members);
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

  it('cancel 落占位消息:stop 时保留已流出的正文(有输出场景)', async () => {
    const h = makeHarness([{ result: '说一半被打断', holdMs: 200 }]);
    await h.orch.onUserMessage('开始');
    await settle(30); // 发言进行中(hold 200ms),streaming 事件已推入 trace
    await h.orch.stop();
    await settle(300);
    const msgs = h.messages.filter((m) => m.from === 'm1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe('说一半被打断'); // 已流出正文保留在占位消息
    expect(h.orch.state).toBe('idle');
    expect(h.orch.statuses['m1']).toBe('idle');
  });

  it('cancel 落占位消息:纯思考阶段停止 → "(已停止思考)"', async () => {
    // 无 streaming 事件(只 thinking):占位文本应为"(已停止思考)"
    const members = makeMembers(1, ['甲']);
    const h = makeHarness([], {}, members, {
      m1: [{ result: '(never streamed)', holdMs: 300, noStream: true }],
    });
    await h.orch.onUserMessage('开始');
    await settle(30);
    await h.orch.stop();
    await settle(400);
    const msgs = h.messages.filter((m) => m.from === 'm1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe('(已停止思考)');
    expect(h.orch.statuses['m1']).toBe('idle');
  });

  it('stop 不触发 resume 重试:cancel 后绝不复活新进程', async () => {
    const members = makeMembers(1, ['甲']);
    members[0]!.sessionIds = { fake: 'sess-1' }; // 模拟首话后已有 session
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
  });

  it('stop 保留待命接棒者:停止不撤销既定意向', async () => {
    const h = makeHarness([], {}, undefined, {
      m2: [{ result: '回答\n<接棒>@丙' }],
      m3: [{ result: '丙待命起头' }],
    });
    await h.orch.onUserMessage('@乙 说');
    await settle(150); // 乙指定丙待命
    await h.orch.stop(); // 无事发生地停止
    randomSpy?.mockReturnValue(0); // 无待命者会选 m1
    await h.orch.onUserMessage('继续');
    await settle(150);
    expect(h.fake.requests[1]?.member).toBe('m3'); // 丙仍起头
  });

  it('session id 捕获后随消息持久化(写穿钩子被调)', async () => {
    const h = makeHarness([{ result: '发言', sessionId: 'sess-123' }]);
    await h.orch.onUserMessage('开始');
    await settle(120);
    expect(h.room.members[0]!.sessionIds?.fake).toBe('sess-123');
  });
});

describe('编排器状态机:杂项入口', () => {
  it('baton 中用户新消息:预算重置,链不断', async () => {
    const h = makeHarness([
      { result: '1\n<接棒>@乙' },
      { result: '2\n<接棒>@甲' },
      { result: '3\n<接棒>@乙' },
      { result: '4\n<接棒>@甲' },
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

  it('空房间纯消息:提示不转移', async () => {
    const h = makeHarness([], {}, []);
    await h.orch.onUserMessage('有人吗');
    await settle(60);
    expect(h.orch.state).toBe('idle');
    expect(h.fake.callCount()).toBe(0);
  });

  it('startFreeDiscussion:开始按钮冷启动(随机起头,非固定第一)', async () => {
    const h = makeHarness([], {}, undefined, {
      m1: [{ result: '我开个头,不传棒' }],
    });
    randomSpy?.mockReturnValue(0.66); // floor(0.66*3)=1 → m2;证明非固定 m1
    const h2 = h; // 同一 harness,脚本按 member:m2 无脚本 → 用 default(空)→ result ''
    // 换个干净装配:m2 有脚本
    const members = makeMembers(3, ['甲', '乙', '丙']);
    const h3 = makeHarness([{ result: '乙开个头' }], {}, members, {
      m2: [{ result: '乙开个头' }],
    });
    randomSpy?.mockReturnValue(0.66);
    h3.orch.startFreeDiscussion();
    await settle(100);
    expect(h3.fake.requests[0]?.member).toBe('m2');
    expect(h3.messages.some((m) => m.from === 'm2')).toBe(true);
    // 不传棒 → idle(链正常终止)
    expect(h3.orch.state).toBe('idle');
  });

  it('startFreeDiscussion 空房间:no-op 不崩', async () => {
    const h = makeHarness([], {}, []);
    h.orch.startFreeDiscussion();
    await settle(50);
    expect(h.orch.state).toBe('idle');
    expect(h.fake.callCount()).toBe(0);
  });

  it('rerollAgent:单次发言后强制进入 idle，且不接棒', async () => {
    const members = makeMembers(2, ['甲', '乙']);
    const h = makeHarness([
      { result: '甲重新发言的内容<接棒>@乙' },
    ], {}, members);

    h.orch.rerollAgent('m1');
    await settle(150);

    // 甲已发言
    const m1Msgs = h.messages.filter((m) => m.from === 'm1');
    expect(m1Msgs.length).toBe(1);
    expect(m1Msgs[0]!.text).toBe('甲重新发言的内容'); // 尾行接棒标记已被剥除
    // 编排器处于 idle，没有传棒给乙
    expect(h.orch.state).toBe('idle');
    expect(h.fake.callCount()).toBe(1);
  });

  it('订阅模式下 @all 不受自动发言上限拦截，且全员依次完成发言', async () => {
    const members = makeMembers(3, ['曹操1', '曹操2', '曹操3']);
    // 设置 chainBudget 为 1, 模拟之前 1 号发言后预算归零的极端场景
    const h = makeHarness([], { mode: 'subscribe', chainBudget: 1 }, members, {
      m1: [{ result: '曹操1投票' }],
      m2: [{ result: '曹操2投票' }],
      m3: [{ result: '曹操3投票' }],
    });

    await h.orch.onUserMessage('@all 1');
    await settle(400);

    // 验证全员都完成了发言
    expect(h.messages.some((m) => m.from === 'm1' && m.text === '曹操1投票')).toBe(true);
    expect(h.messages.some((m) => m.from === 'm2' && m.text === '曹操2投票')).toBe(true);
    expect(h.messages.some((m) => m.from === 'm3' && m.text === '曹操3投票')).toBe(true);
    // 验证没有被误判为自动发言上限
    expect(h.messages.some((m) => m.text.includes('讨论已达自动发言上限'))).toBe(false);
    expect(h.orch.state).toBe('idle');
  });

  it('订阅模式达到发言上限后，用户 @name 点名能顺畅唤醒且不发生死锁', async () => {
    const members = makeMembers(2, ['关羽', '张飞']);
    // 设置 chainBudget 为 1
    const h = makeHarness([], { mode: 'subscribe', chainBudget: 1 }, members, {
      m1: [{ result: '关羽自由发言' }],
      m2: [{ result: '张飞回应用户' }],
    });

    // 1. 用户发纯文本消息触发订阅模式自由讨论 (进入 subscribe 态), 消耗 1 次预算并触发上限
    await h.orch.onUserMessage('诸公请开始讨论');
    await settle(300);

    // 此时应收到上限提示且状态回到 idle
    expect(h.messages.some((m) => m.text.includes('讨论已达自动发言上限'))).toBe(true);
    expect(h.orch.state).toBe('idle');

    // 2. 用户点名 @张飞
    await h.orch.onUserMessage('@张飞 你呢');
    await settle(300);

    // 张飞应当顺畅被唤醒并完成发言，绝不卡死
    expect(h.messages.some((m) => m.from === 'm2' && m.text === '张飞回应用户')).toBe(true);
  });
});

// ---------- i18n:en 语言注入 ----------

describe('i18n:en 语言注入', () => {
  it('getLang=en → 系统消息与 trigger 英文;缺省 zh 逐字节不变', async () => {
    const mem = makeMembers(3, ['甲', '乙', '丙']);
    const room = makeRoomConfig(mem);
    const fake = makeFakeAdapter([{ result: 'done\n<pass>end' }]);
    const messages: ChatMessage[] = [];
    const orch = new Orchestrator({
      room,
      adapterConfigs: { fake: { command: 'fake', args: [] } },
      resolveAdapter: () => fake.impl,
      pushMessage: async (m) => { messages.push(m); },
      sysMessage: async (text) => {
        messages.push({ id: `s${messages.length}`, roomId: room.id, from: 'system', fromName: 'System', text, ts: Date.now(), system: true });
      },
      onStatuses: () => {},
      persistRoom: async () => {},
      runScout: async () => null,
      getHistory: () => messages,
      pushAgentEvent: () => {},
      getLang: () => 'en',
    });
    await orch.onUserMessage('start');
    await settle(200);
    const sys = messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('randomly picked at cold start'); // 起手来源(en)
    expect(sys).toContain('declared the discussion closed'); // <pass>end → en 结束消息
    expect(sys).not.toContain('宣布讨论结束');
    expect(sys).not.toContain('随机选中');

    // zh 路径回归:既有 harness 不注入 getLang,中文原样
    const h2 = makeHarness([{ result: '总结\n<接棒>结束' }]);
    await h2.orch.onUserMessage('开始');
    await settle(150);
    const sys2 = h2.messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys2).toContain('宣布讨论结束');
    expect(sys2).toContain('随机选中');
  });

  it('en 下 prompt trigger 英文(prompt 含 <pass> 教学)', async () => {
    const mem = makeMembers(3, ['甲', '乙', '丙']);
    const room = makeRoomConfig(mem);
    const fake = makeFakeAdapter([
      { result: 'first\n<pass>@乙' },
      { result: 'second, no tag' },
    ]);
    const messages: ChatMessage[] = [];
    const orch = new Orchestrator({
      room,
      adapterConfigs: { fake: { command: 'fake', args: [] } },
      resolveAdapter: () => fake.impl,
      pushMessage: async (m) => { messages.push(m); },
      sysMessage: async (text) => {
        messages.push({ id: `s${messages.length}`, roomId: room.id, from: 'system', fromName: 'System', text, ts: Date.now(), system: true });
      },
      onStatuses: () => {},
      persistRoom: async () => {},
      runScout: async () => null,
      getHistory: () => messages,
      pushAgentEvent: () => {},
      getLang: () => 'en',
    });
    await orch.onUserMessage('start');
    await settle(250);
    // 第一条 prompt 的 trigger 是英文讨论开场(trigger 内容待 prompt 词典任务后随 buildPrompt 变化;此处断言消息链双语即可)
    const sys = messages.filter((m) => m.system).map((m) => m.text).join('|');
    expect(sys).toContain('passed the baton to'); // 🎯 传递消息英文
  });
});
