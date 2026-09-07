import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentAdapter, SpeakRequest } from '../src/adapters/base';
import type { ChatMessage, DiscussionSummary, MemberConfig, RoomConfig } from '../src/core/types';
import { Admin } from '../src/core/admin';
import { buildPrompt } from '../src/core/prompt';
import { buildHeartbeatPrompt } from '../src/core/modes/subscribe/prompt';
import { Orchestrator } from '../src/core/orchestrator';
import {
  filterValidPublic,
  splitHistoryByAnchor,
  isPublicSummaryUsable,
  isDigestUsable,
  countUncoveredPublic,
  countUncoveredPrivateFor,
  uncoveredPrivateMessages,
  isPrivateThreadActive,
  buildInjectionWindow,
  executeCompactSession,
  executePrivateDigest,
} from '../src/core/summaryOps';

describe('上下文压缩层 (Summary & Compact Layer) 核心套件', () => {
  const baseRoom: RoomConfig = {
    id: 'room_test_compact',
    name: '压缩层测试房间',
    topic: '测试议题',
    chainBudget: 10,
    speechLength: 'normal',
    toolPermission: 'readonly',
    mode: 'subscribe',
    members: [
      { id: 'm1', name: '诸葛亮', adapter: 'claude', persona: '军师智囊', color: '#10b981' },
      { id: 'm2', name: '周瑜', adapter: 'claude', persona: '江东大都督', color: '#3b82f6' },
      { id: 'm3', name: '鲁肃', adapter: 'claude', persona: '厚道长者', color: '#f59e0b' },
    ],
    createdAt: Date.now(),
  };

  // ---------- 1. 纯函数测试 ----------
  describe('summaryOps 纯函数计算', () => {
    it('filterValidPublic 严格过滤私聊与系统消息', () => {
      const msgs: ChatMessage[] = [
        { id: '1', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '公聊一', ts: 1 },
        { id: '2', roomId: 'r1', from: 'system', fromName: '系统', text: '系统通知', ts: 2, system: true },
        { id: '3', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '密信内容', ts: 3, audience: ['m2'] },
        { id: '4', roomId: 'r1', from: 'm2', fromName: '周瑜', text: '  ', ts: 4 },
        { id: '5', roomId: 'r1', from: 'm2', fromName: '周瑜', text: '公聊二', ts: 5 },
      ];
      const res = filterValidPublic(msgs);
      expect(res.map((m) => m.id)).toEqual(['1', '5']);
    });

    it('splitHistoryByAnchor 三态判定', () => {
      const msgs: ChatMessage[] = [
        { id: '1', roomId: 'r1', from: 'user', fromName: '用户', text: 'a', ts: 1 },
        { id: '2', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: 'b', ts: 2 },
        { id: '3', roomId: 'r1', from: 'm2', fromName: '周瑜', text: 'c', ts: 3 },
      ];
      // 1) 锚点正常存在
      const s1 = splitHistoryByAnchor(msgs, '2');
      expect(s1.anchorValid).toBe(true);
      expect(s1.after.map((m) => m.id)).toEqual(['3']);

      // 2) 锚点不存在(失效)
      const s2 = splitHistoryByAnchor(msgs, 'not_exist');
      expect(s2.anchorValid).toBe(false);
      expect(s2.after.length).toBe(3);

      // 3) 无锚点
      const s3 = splitHistoryByAnchor(msgs, undefined);
      expect(s3.anchorValid).toBe(false);
      expect(s3.after.length).toBe(3);
    });

    it('isPublicSummaryUsable 降级与失效判定', () => {
      const history: ChatMessage[] = [
        { id: 'msg_1', roomId: 'r1', from: 'user', fromName: '用户', text: 'a', ts: 1 },
      ];

      // 空文本不可用
      expect(isPublicSummaryUsable({ text: '', updatedAt: 1, messageCount: 0 }, history)).toBe(false);

      // 存量老数据(无 coveredMessageId)平滑降级可用
      expect(isPublicSummaryUsable({ text: '老摘要', updatedAt: 1, messageCount: 1 }, history)).toBe(true);

      // 锚点存在且在历史中
      expect(isPublicSummaryUsable({ text: '摘要', coveredMessageId: 'msg_1', updatedAt: 1, messageCount: 1 }, history)).toBe(true);

      // 锚点失效(不在历史中)
      expect(isPublicSummaryUsable({ text: '摘要', coveredMessageId: 'deleted_msg', updatedAt: 1, messageCount: 1 }, history)).toBe(false);
    });

    it('buildInjectionWindow 锚点切分与活跃私聊线程豁免', () => {
      const history: ChatMessage[] = [
        { id: '1', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '旧公聊', ts: 1 },
        { id: '2', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '发起私聊握手', ts: 2, audience: ['m2'], threadId: 'th_active', handshake: 'idea' },
        { id: '3', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '已结束私聊', ts: 3, audience: ['m2'], threadId: 'th_done', handshake: 'agree' },
        { id: '4', roomId: 'r1', from: 'm2', fromName: '周瑜', text: '公聊锚点消息', ts: 4 },
        { id: '5', roomId: 'r1', from: 'm2', fromName: '周瑜', text: '新公聊', ts: 5 },
      ];

      const summary: DiscussionSummary = {
        text: '前期讨论摘要',
        coveredMessageId: '4',
        updatedAt: Date.now(),
        messageCount: 2,
      };

      // 对 m2 组装视窗: 包含锚点后消息 5, 以及锚点前的活跃私聊 2; 但已结束私聊 3 和旧公聊 1 被过滤
      const windowForM2 = buildInjectionWindow(history, 'm2', summary);
      expect(windowForM2.map((m) => m.id)).toEqual(['2', '5']);

      // 对 m3 (无关第三方) 组装视窗: 只能看到新公聊 5
      const windowForM3 = buildInjectionWindow(history, 'm3', summary);
      expect(windowForM3.map((m) => m.id)).toEqual(['5']);
    });
  });

  // ---------- 2. 链式滚动与受众隔离 ----------
  describe('Admin 链式滚动与公聊隔离', () => {
    it('Admin.generateSummary 绝不包含任何带 audience 的私聊文本', async () => {
      let capturedPrompt = '';
      const fakeAdapter: AgentAdapter = {
        speak: (req) => {
          capturedPrompt = req.prompt;
          return {
            done: Promise.resolve({ status: 'ok', result: '### 1. 核心议题\n讨论', durationMs: 100 }),
            cancel: () => {},
          };
        },
      };

      const admin = new Admin(
        { adapter: 'claude', model: 'haiku', allowedTools: '', timeoutMs: 5000, maxRetries: 2 },
        () => fakeAdapter,
        { command: 'echo', args: [] },
      );

      const msgs: ChatMessage[] = [
        { id: '1', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '全员可见的公开观点', ts: 1 },
        { id: '2', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '机密私聊:今夜袭营', ts: 2, audience: ['m2'] },
      ];

      const res = await admin.generateSummary({ messages: msgs });
      expect(res).toBeDefined();
      expect(capturedPrompt).toContain('全员可见的公开观点');
      expect(capturedPrompt).not.toContain('机密私聊:今夜袭营');
      expect(res?.coveredMessageId).toBe('1');
    });

    it('Admin.generateSummary 支持链式滚动合并，并在 prompt 中注入旧摘要', async () => {
      let callCount = 0;
      let lastPrompt = '';
      const fakeAdapter: AgentAdapter = {
        speak: (req) => {
          callCount++;
          lastPrompt = req.prompt;
          return {
            done: Promise.resolve({ status: 'ok', result: `### 1. 核心议题\n第 ${callCount} 版摘要`, durationMs: 100 }),
            cancel: () => {},
          };
        },
      };

      const admin = new Admin(
        { adapter: 'claude', model: 'haiku', allowedTools: '', timeoutMs: 5000, maxRetries: 2 },
        () => fakeAdapter,
        { command: 'echo', args: [] },
      );

      const msgs: ChatMessage[] = [
        { id: '1', roomId: 'r1', from: 'user', fromName: '用户', text: '第一阶段讨论', ts: 1 },
      ];

      // 第一次生成摘要
      const sum1 = await admin.generateSummary({ messages: msgs });
      expect(sum1?.text).toContain('第 1 版摘要');
      expect(sum1?.coveredMessageId).toBe('1');

      // 新增对话并链式生成第二次摘要
      const msgs2: ChatMessage[] = [
        ...msgs,
        { id: '2', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '第二阶段补充', ts: 2 },
      ];
      const sum2 = await admin.generateSummary({ messages: msgs2, prevSummary: sum1 });
      expect(sum2?.text).toContain('第 2 版摘要');
      expect(sum2?.coveredMessageId).toBe('2');
      expect(lastPrompt).toContain('【既有讨论摘要(在其基础上滚动合并更新');
      expect(lastPrompt).toContain('第 1 版摘要');
      expect(lastPrompt).toContain('第二阶段补充');
    });
  });

  // ---------- 3. Prompt 注入测试 (接棒与心跳) ----------
  describe('Prompt 注入视窗与纪要隔离', () => {
    it('buildPrompt 正确注入公聊摘要、私聊纪要及锚点后原文', async () => {
      const history: ChatMessage[] = [
        { id: '1', roomId: 'r1', from: 'user', fromName: '用户', text: '第一句话', ts: 1 },
        { id: 'p1', roomId: 'r1', from: 'm1', fromName: '诸葛亮', audience: ['m2'], text: '诸葛亮给周瑜的私信', ts: 1.5 },
        { id: '2', roomId: 'r1', from: 'm1', fromName: '诸葛亮', text: '第二句话(已在摘要)', ts: 2 },
        { id: '3', roomId: 'r1', from: 'm2', fromName: '周瑜', text: '新鲜发言(未在摘要)', ts: 3 },
      ];

      const summary: DiscussionSummary = {
        text: '已有公聊大纲总结',
        coveredMessageId: '2',
        updatedAt: Date.now(),
        messageCount: 2,
        privateDigests: {
          m1: { text: '诸葛亮的专属密信备忘', coveredMessageId: 'p1', updatedAt: Date.now() },
        },
      };

      // 1) 诸葛亮 (m1) 视角: 包含公聊摘要、本人私聊纪要、以及锚点后的消息 3
      const promptM1 = await buildPrompt(baseRoom, baseRoom.members[0]!, history, { summary });
      expect(promptM1).toContain('【前期讨论摘要】\n已有公聊大纲总结');
      expect(promptM1).toContain('【你的私聊往来纪要(仅你可见)】\n诸葛亮的专属密信备忘');
      expect(promptM1).toContain('新鲜发言(未在摘要)');
      expect(promptM1).not.toContain('第二句话(已在摘要)');

      // 2) 周瑜 (m2) 视角: 包含公聊摘要与新鲜发言，但绝无诸葛亮的私聊纪要
      const promptM2 = await buildPrompt(baseRoom, baseRoom.members[1]!, history, { summary });
      expect(promptM2).toContain('【前期讨论摘要】\n已有公聊大纲总结');
      expect(promptM2).not.toContain('诸葛亮的专属密信备忘');
    });

    it('buildHeartbeatPrompt 心跳 Prompt 正确注入摘要与当前成员纪要', () => {
      const delta: ChatMessage[] = [
        { id: '10', roomId: 'r1', from: 'm2', fromName: '周瑜', text: '心跳前的新消息', ts: 10 },
      ];
      const summary: DiscussionSummary = {
        text: '心跳全局长程摘要',
        coveredMessageId: '9',
        updatedAt: Date.now(),
        messageCount: 5,
        privateDigests: {
          m1: { text: '军师本人的私下结盟', coveredMessageId: 'p2', updatedAt: Date.now() },
        },
      };

      const heartbeatPrompt = buildHeartbeatPrompt(
        baseRoom,
        baseRoom.members[0]!,
        delta,
        undefined,
        undefined,
        summary,
      );

      expect(heartbeatPrompt).toContain('# 前期讨论摘要');
      expect(heartbeatPrompt).toContain('心跳全局长程摘要');
      expect(heartbeatPrompt).toContain('# 你的私聊往来纪要 (仅你可见)');
      expect(heartbeatPrompt).toContain('军师本人的私下结盟');
      expect(heartbeatPrompt).toContain('心跳前的新消息');
    });
  });

  // ---------- 4. Stateful Compact 执行测试 ----------
  describe('Stateful 会话压缩 executeCompactSession', () => {
    it('非 claude 适配器直接跳过返回 false', async () => {
      const res = await executeCompactSession({
        member: baseRoom.members[0]!,
        sessionId: 'sid_123',
        model: 'haiku',
        kind: 'codex',
        adapter: { speak: vi.fn() as any },
        command: 'codex',
        args: [],
      });
      expect(res).toBe(false);
    });

    it('claude 适配器调用 oneShotSpeak 传入 /compact 与 --model haiku', async () => {
      let receivedReq: SpeakRequest | undefined;
      const fakeAdapter: AgentAdapter = {
        speak: (req) => {
          receivedReq = req;
          return {
            done: Promise.resolve({ status: 'ok', result: 'compacted', durationMs: 200 }),
            cancel: () => {},
          };
        },
      };

      const res = await executeCompactSession({
        member: baseRoom.members[0]!,
        sessionId: 'sid_sess_456',
        model: 'haiku',
        kind: 'claude',
        adapter: fakeAdapter,
        command: 'claude',
        args: ['-p'],
      });

      expect(res).toBe(true);
      expect(receivedReq).toBeDefined();
      expect(receivedReq?.prompt).toBe('/compact');
      expect(receivedReq?.resumeSessionId).toBe('sid_sess_456');
      expect(receivedReq?.args).toContain('--model');
      expect(receivedReq?.args).toContain('haiku');
      expect(receivedReq?.permission).toBe('readonly');
    });
  });

  // ---------- 5. F1 修复: compact 计数统一收口(用户/接棒消息全覆盖) ----------
  describe('compact 计数收口与触发(接棒 stateful 房间)', () => {
    // Math.random mock → 0: 冷启动随机永远选中 members[0](m1,带 session 的那位)
    let randomSpy: ReturnType<typeof vi.spyOn> | null = null;
    beforeEach(() => {
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    });
    afterEach(() => {
      randomSpy?.mockRestore();
    });

    /** 构造 stateful 接棒房间 harness: fake adapter 记录全部请求(含 /compact) */
    function makeStatefulHarness(over: Partial<RoomConfig> = {}, withSession = true) {
      const members: MemberConfig[] = [
        { id: 'm1', name: '甲', adapter: 'fake', persona: '测试', color: '#000', ...(withSession ? { sessionIds: { fake: 'sess1' } } : {}) },
        { id: 'm2', name: '乙', adapter: 'fake', persona: '测试', color: '#111' },
      ];
      const room: RoomConfig = {
        ...baseRoom,
        mode: 'baton',
        members,
        contextMode: 'stateful',
        ...over,
      };
      const requests: SpeakRequest[] = [];
      const impl: AgentAdapter = {
        speak: (req) => {
          requests.push(req);
          return {
            done: Promise.resolve({ status: 'ok', result: '发言完毕', durationMs: 10 }),
            cancel: () => {},
          };
        },
      };
      const messages: ChatMessage[] = [];
      const orch = new Orchestrator({
        room,
        adapterConfigs: { fake: { kind: 'claude', command: 'fake-cli', args: ['-p'] } },
        resolveAdapter: () => impl,
        pushMessage: async (m) => { messages.push(m); },
        sysMessage: async (text) => {
          messages.push({ id: `sys${messages.length}`, roomId: room.id, from: 'system', fromName: '系统', text, ts: Date.now(), system: true });
        },
        onStatuses: () => {},
        persistRoom: async () => {},
        runScout: async () => null,
        getHistory: () => messages,
        pushAgentEvent: () => {},
        summaryCfg: { model: 'haiku', autoThreshold: 0, privateThreshold: 0, compactThreshold: 40 },
      });
      return { orch, requests, messages, room };
    }

    const publicMsg = (i: number): ChatMessage => ({
      id: `note_${i}`, roomId: 'r1', from: 'user', fromName: '用户', text: `第${i}条`, ts: i,
    });

    it('41 条可见消息后发言 done → 触发 /compact(用户消息计数全覆盖)', async () => {
      const { orch, requests } = makeStatefulHarness();
      for (let i = 0; i < 41; i++) orch.noteMessageForCompact(publicMsg(i));
      await orch.onUserMessage('聊'); // Math.random 未 mock 也无妨:成员脚本相同
      await new Promise((r) => setTimeout(r, 50));
      const compactReq = requests.find((r) => r.prompt === '/compact');
      expect(compactReq).toBeDefined();
      expect(compactReq?.resumeSessionId).toBe('sess1');
      expect(compactReq?.args).toContain('--model');
      expect(compactReq?.args).toContain('haiku');
    });

    it('恰好 40 条 → 不触发(严格大于)', async () => {
      const { orch, requests } = makeStatefulHarness();
      for (let i = 0; i < 40; i++) orch.noteMessageForCompact(publicMsg(i));
      await orch.onUserMessage('聊');
      await new Promise((r) => setTimeout(r, 50));
      expect(requests.some((r) => r.prompt === '/compact')).toBe(false);
    });

    it('stateless 房间 → 计数入口直返,绝不 compact', async () => {
      const { orch, requests } = makeStatefulHarness({ contextMode: 'stateless' });
      for (let i = 0; i < 100; i++) orch.noteMessageForCompact(publicMsg(i));
      await orch.onUserMessage('聊');
      await new Promise((r) => setTimeout(r, 50));
      expect(requests.some((r) => r.prompt === '/compact')).toBe(false);
    });

    it('成员无 sessionId → 跳过 compact', async () => {
      const { orch, requests } = makeStatefulHarness({}, false);
      for (let i = 0; i < 41; i++) orch.noteMessageForCompact(publicMsg(i));
      await orch.onUserMessage('聊');
      await new Promise((r) => setTimeout(r, 50));
      expect(requests.some((r) => r.prompt === '/compact')).toBe(false);
    });

    it('系统消息与侦察报告不计入 compact 计数', async () => {
      const { orch, requests } = makeStatefulHarness();
      for (let i = 0; i < 41; i++) {
        orch.noteMessageForCompact({ ...publicMsg(i), system: true, from: 'system' });
      }
      for (let i = 0; i < 41; i++) {
        orch.noteMessageForCompact({ id: `scout_${i}`, roomId: 'r1', from: 'scout', fromName: '侦察员', text: '报告', ts: i });
      }
      await orch.onUserMessage('聊');
      await new Promise((r) => setTimeout(r, 50));
      expect(requests.some((r) => r.prompt === '/compact')).toBe(false);
    });

    it('私聊消息只计入当事人(发送者+受众),无关成员不计数', async () => {
      // 第三个成员 m3(无 session、与私聊无关): m1↔m2 密聊 41 条,m3 计数必须为 0
      const members: MemberConfig[] = [
        { id: 'm1', name: '甲', adapter: 'fake', persona: '测试', color: '#000', sessionIds: { fake: 'sess1' } },
        { id: 'm2', name: '乙', adapter: 'fake', persona: '测试', color: '#111' },
        { id: 'm3', name: '丙', adapter: 'fake', persona: '测试', color: '#222' },
      ];
      const requests: SpeakRequest[] = [];
      const impl: AgentAdapter = {
        speak: (req) => {
          requests.push(req);
          return { done: Promise.resolve({ status: 'ok', result: 'ok', durationMs: 10 }), cancel: () => {} };
        },
      };
      const messages: ChatMessage[] = [];
      const room: RoomConfig = { ...baseRoom, mode: 'baton', members, contextMode: 'stateful' };
      const orch = new Orchestrator({
        room,
        adapterConfigs: { fake: { kind: 'claude', command: 'fake-cli', args: ['-p'] } },
        resolveAdapter: () => impl,
        pushMessage: async (m) => { messages.push(m); },
        sysMessage: async (text) => {
          messages.push({ id: `sys${messages.length}`, roomId: room.id, from: 'system', fromName: '系统', text, ts: Date.now(), system: true });
        },
        onStatuses: () => {},
        persistRoom: async () => {},
        runScout: async () => null,
        getHistory: () => messages,
        pushAgentEvent: () => {},
        summaryCfg: { model: 'haiku', autoThreshold: 0, privateThreshold: 0, compactThreshold: 40 },
      });

      for (let i = 0; i < 41; i++) {
        orch.noteMessageForCompact({
          id: `pm_${i}`, roomId: 'r1', from: 'm1', fromName: '甲', text: '密信', ts: i, audience: ['m2'],
        });
      }
      // 随机 mock=0 → m1 起头(计数 41 > 40,有 session → compact);
      // m3 虽在成员表但其计数为 0,不会被 compact(也无 session,天然安全)
      await orch.onUserMessage('聊');
      await new Promise((r) => setTimeout(r, 50));
      const compactReqs = requests.filter((r) => r.prompt === '/compact');
      expect(compactReqs.length).toBe(1); // 仅 m1;验证私聊计数对当事人生效且无误伤
      expect(compactReqs[0]?.resumeSessionId).toBe('sess1');
    });
  });

  // ---------- 6. F2+F3 修复: 纪要增量喂入与链式锚点失效丢弃 ----------
  describe('私聊纪要增量喂入与锚点失效', () => {
    const mkPrivate = (id: string, from: string, to: string, text: string): ChatMessage => ({
      id, roomId: 'r1', from, fromName: from === 'm1' ? '甲' : '乙', text, ts: Number(id.slice(1)), audience: [to],
    });

    it('uncoveredPrivateMessages: 锚点命中→增量;锚点失踪→anchorValid=false+全量', () => {
      const history = [
        mkPrivate('p1', 'm1', 'm2', '旧私聊1'),
        mkPrivate('p2', 'm1', 'm2', '旧私聊2'),
        mkPrivate('p3', 'm2', 'm1', '新私聊1'),
      ];
      const digest = { text: '既有纪要', coveredMessageId: 'p2', updatedAt: 1 };

      const hit = uncoveredPrivateMessages(history, 'm1', digest);
      expect(hit.anchorValid).toBe(true);
      expect(hit.delta.map((m) => m.id)).toEqual(['p3']);

      const miss = uncoveredPrivateMessages(history, 'm1', { ...digest, coveredMessageId: 'deleted' });
      expect(miss.anchorValid).toBe(false);
      expect(miss.delta.length).toBe(3);

      const none = uncoveredPrivateMessages(history, 'm1', null);
      expect(none.anchorValid).toBe(false);
      expect(none.delta.length).toBe(3);
    });

    it('executePrivateDigest 第二轮只喂增量: prompt 含新私聊与旧纪要,不含旧私聊原文', async () => {
      const prompts: string[] = [];
      const fakeAdapter: AgentAdapter = {
        speak: (req) => {
          prompts.push(req.prompt);
          return {
            done: Promise.resolve({ status: 'ok', result: `第 ${prompts.length} 版纪要`, durationMs: 10 }),
            cancel: () => {},
          };
        },
      };
      const member: MemberConfig = { id: 'm1', name: '甲', adapter: 'fake', persona: '军师', color: '#000' };

      const firstBatch = [mkPrivate('p1', 'm1', 'm2', '早期密谋细节'), mkPrivate('p2', 'm1', 'm2', '早期补充')];
      const d1 = await executePrivateDigest({ member, privateMessages: firstBatch, adapter: fakeAdapter, command: 'c', args: [] });
      expect(d1?.coveredMessageId).toBe('p2');
      expect(prompts[0]).toContain('早期密谋细节');

      // 新增 5 条,喂入 delta(锚点 p2 之后)
      const history = [...firstBatch, ...Array.from({ length: 5 }, (_, i) => mkPrivate(`n${i}`, 'm2', 'm1', `新动向${i}`))];
      const { delta } = uncoveredPrivateMessages(history, 'm1', d1);
      const d2 = await executePrivateDigest({ member, privateMessages: delta, prevDigest: d1, adapter: fakeAdapter, command: 'c', args: [] });

      expect(d2?.coveredMessageId).toBe('n4');
      expect(prompts[1]).toContain('既有私聊纪要');
      expect(prompts[1]).toContain('第 1 版纪要');
      expect(prompts[1]).toContain('新动向0');
      expect(prompts[1]).toContain('新动向4');
      expect(prompts[1]).not.toContain('早期密谋细节'); // 旧私聊原文绝不重复喂入
    });

    it('锚点失效时 prevDigest 传 null: 旧纪要文本不再污染新纪要 prompt', async () => {
      const prompts: string[] = [];
      const fakeAdapter: AgentAdapter = {
        speak: (req) => {
          prompts.push(req.prompt);
          return { done: Promise.resolve({ status: 'ok', result: '重摘纪要', durationMs: 10 }), cancel: () => {} };
        },
      };
      const member: MemberConfig = { id: 'm1', name: '甲', adapter: 'fake', persona: '军师', color: '#000' };

      // 锚点 'ghost' 不在历史 → anchorValid=false(调用方语义: prevDigest 置 null)
      const history = [mkPrivate('q1', 'm1', 'm2', '截断后的新私聊')];
      const stale = { text: '含已删除内容的旧纪要', coveredMessageId: 'ghost', updatedAt: 1 };
      const { anchorValid, delta } = uncoveredPrivateMessages(history, 'm1', stale);
      expect(anchorValid).toBe(false);

      await executePrivateDigest({
        member, privateMessages: delta,
        prevDigest: anchorValid ? stale : null, // room.generatePrivateDigestFor 同款写法
        adapter: fakeAdapter, command: 'c', args: [],
      });
      expect(prompts[0]).toContain('截断后的新私聊');
      expect(prompts[0]).not.toContain('含已删除内容的旧纪要');
      expect(prompts[0]).not.toContain('既有私聊纪要'); // 无旧纪要 → 走全量分支
    });
  });

  // ---------- 7. F4 修复: 心跳 Prompt 锚点失效校验 ----------
  describe('buildHeartbeatPrompt 锚点失效校验', () => {
    const mkMsg = (id: string, text: string): ChatMessage => ({
      id, roomId: 'r1', from: 'm2', fromName: '乙', text, ts: Number(id.slice(1)),
    });
    const delta = [mkMsg('10', '心跳增量消息')];

    it('摘要锚点不在 fullHistory → 摘要与纪要段均不注入', () => {
      const summary: DiscussionSummary = {
        text: '幽灵摘要', coveredMessageId: 'deleted_anchor', updatedAt: 1, messageCount: 1,
        privateDigests: { m1: { text: '幽灵纪要', coveredMessageId: 'p1', updatedAt: 1 } },
      };
      const p = buildHeartbeatPrompt(baseRoom, baseRoom.members[0]!, delta, undefined, undefined, summary, [mkMsg('1', '现存消息')]);
      expect(p).not.toContain('# 前期讨论摘要');
      expect(p).not.toContain('幽灵摘要');
      expect(p).not.toContain('你的私聊往来纪要');
      expect(p).toContain('心跳增量消息');
    });

    it('摘要锚点有效 → 摘要与纪要段都在', () => {
      const summary: DiscussionSummary = {
        text: '有效摘要', coveredMessageId: '1', updatedAt: 1, messageCount: 1,
        privateDigests: { m1: { text: '有效纪要', coveredMessageId: 'p1', updatedAt: 1 } },
      };
      const history = [mkMsg('1', '锚点消息'), { id: 'p1', roomId: 'r1', from: 'm1', fromName: '甲', text: '私聊', ts: 1.5, audience: ['m2'] }];
      const p = buildHeartbeatPrompt(baseRoom, baseRoom.members[0]!, delta, undefined, undefined, summary, history);
      expect(p).toContain('# 前期讨论摘要');
      expect(p).toContain('有效摘要');
      expect(p).toContain('有效纪要');
    });

    it('摘要锚点有效但本人纪要锚点失效 → 摘要在,纪要剔除', () => {
      const summary: DiscussionSummary = {
        text: '有效摘要', coveredMessageId: '1', updatedAt: 1, messageCount: 1,
        privateDigests: { m1: { text: '失效纪要', coveredMessageId: 'ghost', updatedAt: 1 } },
      };
      const history = [mkMsg('1', '锚点消息')];
      const p = buildHeartbeatPrompt(baseRoom, baseRoom.members[0]!, delta, undefined, undefined, summary, history);
      expect(p).toContain('# 前期讨论摘要');
      expect(p).not.toContain('失效纪要');
    });

    it('不传 fullHistory → 维持原行为不校验(向后兼容)', () => {
      const summary: DiscussionSummary = {
        text: '无历史校验摘要', coveredMessageId: 'whatever', updatedAt: 1, messageCount: 1,
      };
      const p = buildHeartbeatPrompt(baseRoom, baseRoom.members[0]!, delta, undefined, undefined, summary);
      expect(p).toContain('# 前期讨论摘要');
    });
  });
});
