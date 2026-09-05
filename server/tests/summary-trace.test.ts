import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { saveTrace, getTrace, listTraces, computeSessionStats } from '../src/store/trace';
import { saveSummary, getSummary } from '../src/store/summary';
import { buildPrompt } from '../src/core/prompt';
import { Admin } from '../src/core/admin';
import type { AgentTraceLog, DiscussionSummary, MemberConfig, RoomConfig, ChatMessage } from '../src/core/types';
import type { AgentAdapter } from '../src/adapters/base';
import { REPO_ROOT } from '../src/paths';

const TEST_ROOM_ID = 'test_room_summary_trace';
const TEST_CHAR_ID = 'test_char_summary_trace';

describe('B2 讨论摘要与 Agent Trace 持久化测试', () => {
  const roomTraceDir = path.join(REPO_ROOT, 'data', 'traces', 'rooms', TEST_ROOM_ID);
  const directTraceDir = path.join(REPO_ROOT, 'data', 'traces', 'direct', TEST_CHAR_ID);

  afterEach(async () => {
    try {
      if (existsSync(roomTraceDir)) await rm(roomTraceDir, { recursive: true, force: true });
      if (existsSync(directTraceDir)) await rm(directTraceDir, { recursive: true, force: true });
    } catch {}
  });

  it('TraceStore: 能正确保存并懒加载房间与私聊的完整 Trace 日志', async () => {
    const trace1: AgentTraceLog = {
      messageId: 'msg_001',
      roomId: TEST_ROOM_ID,
      memberId: 'm1',
      memberName: '诸葛亮',
      adapter: 'claude',
      ts: Date.now() - 1000,
      durationMs: 1200,
      status: 'ok',
      trigger: '用户提问',
      input: {
        prompt: '测试 Prompt 全文内容...',
        command: 'claude',
        args: ['-p', '--model', 'sonnet'],
      },
      output: {
        result: '这是诸葛亮的最终回答',
        thinking: '我在思考计策...',
        trace: [{ kind: 'text', ts: Date.now(), content: '回答中' }],
      },
    };

    const trace2: AgentTraceLog = {
      messageId: 'msg_002',
      roomId: TEST_ROOM_ID,
      memberId: 'm2',
      memberName: '周瑜',
      adapter: 'claude',
      ts: Date.now(),
      durationMs: 800,
      status: 'ok',
      trigger: '接棒发言',
      input: {
        prompt: '周瑜收到的 Prompt...',
      },
      output: {
        result: '既生瑜何生亮',
      },
    };

    // 保存两条 Trace
    await saveTrace('room', TEST_ROOM_ID, trace1);
    await saveTrace('room', TEST_ROOM_ID, trace2);

    // 获取列表概览
    const list = await listTraces('room', TEST_ROOM_ID);
    expect(list.length).toBe(2);
    // 按时间倒序
    expect(list[0]!.messageId).toBe('msg_002');
    expect(list[1]!.messageId).toBe('msg_001');

    // 懒加载单条完整详情
    const detail1 = await getTrace('room', TEST_ROOM_ID, 'msg_001');
    expect(detail1).toBeDefined();
    expect(detail1?.input.prompt).toBe('测试 Prompt 全文内容...');
    expect(detail1?.output.thinking).toBe('我在思考计策...');
    expect(detail1?.output.result).toBe('这是诸葛亮的最终回答');
  });

  it('SummaryStore: 讨论摘要能正确读写持久化', async () => {
    const summary: DiscussionSummary = {
      text: '### 1. 核心议题\n探讨草船借箭。\n\n### 2. 各方观点\n诸葛亮主张借箭，周瑜质疑。\n\n### 3. 共识\n三日为限。',
      updatedAt: Date.now(),
      messageCount: 15,
      status: 'idle',
    };

    await saveSummary('room', TEST_ROOM_ID, summary);
    const loaded = await getSummary('room', TEST_ROOM_ID);
    expect(loaded).toBeDefined();
    expect(loaded?.text).toContain('探讨草船借箭');
    expect(loaded?.messageCount).toBe(15);
  });

  it('Prompt: buildPrompt 在提供 summary 时，能正确注入前期讨论摘要段落', async () => {
    const room: RoomConfig = {
      id: 'room_1',
      name: '战略研讨室',
      topic: '赤壁之战',
      chainBudget: 6,
      speechLength: 'normal',
      mode: 'baton',
      members: [
        { id: 'm1', name: '诸葛亮', adapter: 'claude', persona: '蜀国丞相', color: '#10b981' },
        { id: 'm2', name: '鲁肃', adapter: 'claude', persona: '东吴大夫', color: '#3b82f6' },
      ],
      createdAt: Date.now(),
    };

    const member = room.members[0]!;
    const history: ChatMessage[] = [
      { id: '1', roomId: 'room_1', from: 'user', fromName: '用户', text: '东风何时会来？', ts: 1 },
      { id: '2', roomId: 'room_1', from: 'm2', fromName: '鲁肃', text: '冬至已过，未见东风。', ts: 2 },
    ];

    const promptWithSummary = await buildPrompt(room, member, history, {
      trigger: '请回应',
      summary: '前期已有定计，孔明将借东南风。',
    });

    expect(promptWithSummary).toContain('【前期讨论摘要】');
    expect(promptWithSummary).toContain('前期已有定计，孔明将借东南风。');
    expect(promptWithSummary).toContain('【近期讨论发言(按时间顺序,最新在后)】');
    expect(promptWithSummary).toContain('**[鲁肃] (全员公聊)：**');
    expect(promptWithSummary).toContain('冬至已过，未见东风。');
  });

  it('Admin: generateSummary 能够调用适配器产出结构化摘要', async () => {
    const fakeResult = `### 1. 核心议题与讨论背景
双方就联吴抗曹方案进行可行性推演。

### 2. 各方主要观点与分歧
诸葛亮强调兵力互补，孙权顾虑曹军势大。

### 3. 已达成共识与下一步焦点
达成联合出兵意向，待周瑜回柴桑定夺。`;

    const fakeAdapter: AgentAdapter = {
      speak: (req, onEvent) => {
        return {
          done: Promise.resolve({
            status: 'ok',
            result: fakeResult,
            durationMs: 450,
          }),
          cancel: () => {},
        };
      },
    };

    const admin = new Admin(
      {
        adapter: 'fake',
        model: 'haiku',
        allowedTools: 'Read',
        timeoutMs: 5000,
        maxRetries: 2,
      },
      () => fakeAdapter,
      { command: 'fake-cli', args: [] },
    );

    const messages: ChatMessage[] = [
      { id: '1', roomId: 'r1', from: 'user', fromName: '用户', text: '曹操率大军八十万下江南', ts: 1 },
      { id: '2', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '曹军远道而来，不习水战，何足惧哉', ts: 2 },
    ];

    const summary = await admin.generateSummary(messages, '赤壁抗曹战役研讨');
    expect(summary).toBeDefined();
    expect(summary?.status).toBe('idle');
    expect(summary?.text).toContain('### 1. 核心议题与讨论背景');
    expect(summary?.text).toContain('双方就联吴抗曹方案进行可行性推演');
    expect(summary?.messageCount).toBe(2);
  });

  it('Orchestrator: Agent 一次物理调用产生公聊+私聊时只落一份 Trace 且 Prompt 真实完整', async () => {
    const { Orchestrator } = await import('../src/core/orchestrator');
    const pushedMessages: ChatMessage[] = [];

    const fakeAdapter: AgentAdapter = {
      speak: (req) => {
        return {
          done: Promise.resolve({
            status: 'ok',
            result: '哈哈哈哈，这是公聊正文！\n<私聊>@周瑜 兄弟，这是私聊悄悄话。',
            durationMs: 320,
          }),
          cancel: () => {},
        };
      },
    };

    const room: RoomConfig = {
      id: TEST_ROOM_ID,
      name: '测试公私聊Trace',
      topic: '测试',
      mode: 'subscribe',
      chainBudget: 10,
      moderatorId: 'm1',
      members: [
        { id: 'm1', name: '诸葛亮', adapter: 'fake', persona: '军师' },
        { id: 'm2', name: '周瑜', adapter: 'fake', persona: '都督' },
      ],
    };

    const orchestrator = new Orchestrator({
      room,
      resolveAdapter: () => fakeAdapter,
      getHistory: () => [],
      adapterConfigs: {
        fake: { command: 'fake', args: [] },
      },
      pushMessage: async (m) => {
        pushedMessages.push(m);
      },
      sysMessage: async () => {},
      onStatuses: () => {},
      persistRoom: async () => {},
      runScout: async () => null,
      pushAgentEvent: () => {},
    });

    // 模拟运行单次发言
    await (orchestrator as any).runOne(room.members[0], {
      memberId: 'm1',
      trigger: '请开始你的表演',
      instruction: undefined,
      batonMode: undefined,
      generation: 0,
    });

    // 验证聊天区成功拆出了 2 条气泡 (公聊 + 私聊)
    expect(pushedMessages.length).toBe(2);
    expect(pushedMessages[0]?.text).toContain('哈哈哈哈，这是公聊正文！');
    expect(pushedMessages[1]?.text).toContain('兄弟，这是私聊悄悄话。');

    // 等待异步落盘完成
    await new Promise((r) => setTimeout(r, 100));

    // 核心验证：TraceStore 中只落盘了 1 份唯一的完整 Trace！
    const traces = await listTraces('room', TEST_ROOM_ID);
    expect(traces.length).toBe(1);
    expect(traces[0]?.memberName).toBe('诸葛亮');

    // 核心验证：Trace 的输出是公聊与私聊一体的完整原始输出，输入是真实构建的 Prompt
    const traceDetail = await getTrace('room', TEST_ROOM_ID, traces[0]!.messageId);
    expect(traceDetail).toBeDefined();
    expect(traceDetail?.output.result).toContain('哈哈哈哈，这是公聊正文！');
    expect(traceDetail?.output.result).toContain('<私聊>@周瑜 兄弟，这是私聊悄悄话。');
    expect(traceDetail?.input.prompt).toContain('# 你的角色');
    expect(traceDetail?.input.prompt).toContain('军师');
    expect(traceDetail?.input.prompt).toContain('周瑜');
  });

  it('Stats: 能准确聚合消息发言份额、Token用量与估算费用', async () => {
    // 模拟持久化一份带 usage 的 trace
    const traceWithUsage: AgentTraceLog = {
      messageId: 'msg_trace_01',
      roomId: TEST_ROOM_ID,
      memberId: 'm1',
      memberName: '诸葛亮',
      adapter: 'claude',
      ts: Date.now(),
      durationMs: 1500,
      status: 'ok',
      trigger: '讨论',
      input: { prompt: 'Prompt...' },
      output: {
        result: '计策已定。',
        usage: {
          inputTokens: 1200,
          outputTokens: 300,
          totalTokens: 1500,
          costUsd: 0.0081,
        },
      },
    };
    await saveTrace('room', TEST_ROOM_ID, traceWithUsage);

    const members = [
      { id: 'm1', name: '诸葛亮', color: '#3b82f6', adapter: 'claude' },
      { id: 'm2', name: '周瑜', color: '#ef4444', adapter: 'codex' },
    ];
    const messages: ChatMessage[] = [
      {
        id: 'msg_user_1',
        roomId: TEST_ROOM_ID,
        from: 'user',
        fromName: 'User',
        text: '诸葛先生有何妙计？',
        ts: Date.now() - 5000,
      },
      {
        id: 'msg_trace_01',
        roomId: TEST_ROOM_ID,
        from: 'm1',
        fromName: '诸葛亮',
        text: '计策已定。草船借箭万无一失。',
        ts: Date.now(),
      },
    ];

    const stats = await computeSessionStats('room', TEST_ROOM_ID, members, messages);

    expect(stats.totalMessages).toBe(2);
    expect(stats.totalCostUsd).toBe(0.0081);
    expect(stats.totalInputTokens).toBe(1200);
    expect(stats.totalOutputTokens).toBe(300);
    expect(stats.totalTokens).toBe(1500);
    expect(stats.members.length).toBe(3); // user, m1, m2

    const zhuge = stats.members.find((m) => m.id === 'm1');
    expect(zhuge).toBeDefined();
    expect(zhuge?.messageCount).toBe(1);
    expect(zhuge?.totalTokens).toBe(1500);
    expect(zhuge?.costUsd).toBe(0.0081);
    expect(zhuge?.sharePct).toBeGreaterThan(0);
  });
});
