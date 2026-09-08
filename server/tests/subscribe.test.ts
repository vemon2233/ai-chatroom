import { describe, expect, it, vi } from 'vitest';
import {
  parseAudience,
  stripAudienceLine,
  filterHistoryForViewer,
  parseHandshake,
  splitPublicAndPrivateMessage,
} from '../src/core/modes/subscribe/audience';
import { matchMemberByName } from '../src/core/naming';
import { PrivateChatProtocol } from '../src/core/modes/subscribe/protocol';
import { isSilentDecision, buildHeartbeatPrompt } from '../src/core/modes/subscribe/prompt';
import { SubscribeEngine } from '../src/core/modes/subscribe/engine';
import { Orchestrator } from '../src/core/orchestrator';
import type { ChatMessage, MemberConfig, RoomConfig } from '../src/core/types';
import type { AgentAdapter } from '../src/adapters/base';

describe('订阅模式: 私聊受众解析与过滤 (audience)', () => {
  const members = [
    { id: 'm1', name: '架构师' },
    { id: 'm2', name: '工程师' },
    { id: 'm3', name: '产品经理' },
  ];

  it('能准确解析末行的 <私聊>@名字 列表', () => {
    const text = '我认为这个方案可行。\n<私聊>@架构师 @产品经理';
    const audience = parseAudience(text, members);
    expect(audience).toEqual(expect.arrayContaining(['m1', 'm3']));
    expect(audience).not.toContain('m2');
  });

  it('兼容【私聊】旧格式', () => {
    const text = '这是敏感讨论内容。\n【私聊】@工程师';
    const audience = parseAudience(text, members);
    expect(audience).toEqual(['m2']);
  });

  it('无私聊标记时返回 undefined(公聊)', () => {
    const text = '大家好，今天我们讨论架构重构方案。';
    const audience = parseAudience(text, members);
    expect(audience).toBeUndefined();
  });

  it('解析私聊握手标签: <同意>、<拒绝>、<想法> @名字', () => {
    expect(parseHandshake('我觉得可以。<同意>', members)).toEqual({ type: 'agree', targetMemberId: undefined });
    expect(parseHandshake('这不合理。<拒绝>', members)).toEqual({ type: 'reject', targetMemberId: undefined });
    expect(parseHandshake('我认为可以用缓存。<想法> @架构师', members)).toEqual({
      type: 'idea',
      targetMemberId: 'm1',
    });
  });

  it('智能语义推断握手意图: 无显式尖括号标签时仍能识别态度', () => {
    const split = splitPublicAndPrivateMessage(
      '<私聊>@工程师 可以，依你说的办：投票时你先亮票。',
      members,
    );
    expect(split.handshake).toBe('agree');

    const splitReject = splitPublicAndPrivateMessage(
      '<私聊>@工程师 恕难从命，这绝无可能！',
      members,
    );
    expect(splitReject.handshake).toBe('reject');
  });

  it('剥除文本末尾的私聊行与握手标签', () => {
    const text1 = '方案通过。<私聊>@架构师';
    expect(stripAudienceLine(text1)).toBe('方案通过。');

    const text2 = '同意此方案。<同意>';
    expect(stripAudienceLine(text2)).toBe('同意此方案。');

    const text3 = '我有其他建议。<想法> @架构师';
    expect(stripAudienceLine(text3)).toBe('我有其他建议。');
  });

  it('受众消息在不同成员视角下的历史可见性过滤', () => {
    const history: ChatMessage[] = [
      { id: '1', roomId: 'r1', from: 'm1', fromName: '架构师', text: '公聊消息', ts: 100 },
      { id: '2', roomId: 'r1', from: 'm1', fromName: '架构师', text: '仅产品经理可见', ts: 101, audience: ['m3'] },
      { id: '3', roomId: 'r1', from: 'system', fromName: '系统', text: '系统通知', ts: 102, system: true },
    ];

    // 产品经理(m3)视角: 可见公聊、系统消息以及作为受众的私聊
    const m3View = filterHistoryForViewer(history, 'm3');
    expect(m3View.map((m) => m.id)).toEqual(['1', '2', '3']);

    // 工程师(m2)视角: 不可见非其受众的私聊消息
    const m2View = filterHistoryForViewer(history, 'm2');
    expect(m2View.map((m) => m.id)).toEqual(['1', '3']);

    // 发送者架构师(m1)视角: 自己发出的私聊对自己可见
    const m1View = filterHistoryForViewer(history, 'm1');
    expect(m1View.map((m) => m.id)).toEqual(['1', '2', '3']);
  });
});

describe('订阅模式: 私聊握手协议与 3 条硬闸熔断 (protocol)', () => {
  it('发起新私聊并遵循 3 条硬闸限制', () => {
    const protocol = new PrivateChatProtocol();

    // 1. 发起新私聊 -> count = 1
    const t1 = protocol.startThread('m1', 'm2');
    expect(t1.count).toBe(1);
    expect(t1.status).toBe('active');

    // 2. 对方回应 <想法> -> count = 2
    const res2 = protocol.handleResponse(t1.threadId, 'm2', { type: 'idea' });
    expect(res2.thread.count).toBe(2);
    expect(res2.isClosed).toBe(false);

    // 3. 再次回应 -> count = 3 -> 触发硬闸自动 closed
    const res3 = protocol.handleResponse(t1.threadId, 'm1', { type: 'idea' });
    expect(res3.thread.count).toBe(3);
    expect(res3.isClosed).toBe(true);
    expect(protocol.getActiveThread('m1')).toBeUndefined();
  });

  it('收到 <同意> 或 <拒绝> 立即终结私聊', () => {
    const protocol = new PrivateChatProtocol();
    const t = protocol.startThread('m1', 'm2');

    const res = protocol.handleResponse(t.threadId, 'm2', { type: 'agree' });
    expect(res.isClosed).toBe(true);
    expect(protocol.getActiveThread('m1')).toBeUndefined();
  });

  it('多场私聊拥有全局自增序号: 私聊1、私聊2', () => {
    const protocol = new PrivateChatProtocol();

    // 吕布向吕布2发起 -> 应该分配 index = 1
    const t1 = protocol.startThread('lvbu', 'lvbu2');
    expect(t1.index).toBe(1);

    // 吕布2回复吕布 -> 复用 t1, index 依然为 1
    const reply1 = protocol.handleResponse(t1.threadId, 'lvbu2', { type: 'idea' });
    expect(reply1.thread.index).toBe(1);

    // 随后吕布向吕布3发起新私聊 -> 应该分配 index = 2
    const t2 = protocol.startThread('lvbu', 'lvbu3');
    expect(t2.index).toBe(2);

    // 吕布3回复吕布 -> 复用 t2, index 依然为 2
    const reply2 = protocol.handleResponse(t2.threadId, 'lvbu3', { type: 'agree' });
    expect(reply2.thread.index).toBe(2);
  });

  it('closeThreadsForMember: 成员移除关闭其参与的活跃线程,他人线程不受影响', () => {
    const protocol = new PrivateChatProtocol();
    const t1 = protocol.startThread('m1', 'm2'); // 甲↔乙
    protocol.handleResponse(t1.threadId, 'm2', { type: 'idea' }); // count=2 活跃中
    const t2 = protocol.startThread('m3', 'm4'); // 丙↔丁(与移除者无关)

    protocol.closeThreadsForMember('m2'); // 乙被移除

    expect(protocol.getActiveThread('m1')).toBeUndefined(); // 甲↔乙 已关
    expect(protocol.getActiveThread('m2')).toBeUndefined();
    expect(protocol.getActiveThread('m3')).toBeDefined(); // 丙↔丁 不受影响
    expect(protocol.getActiveThread('m4')).toBeDefined();
  });
});

describe('订阅模式: 增量视窗与自决判断 (prompt)', () => {
  it('精准识别 <沉默> 自决输出', () => {
    expect(isSilentDecision('<沉默>')).toBe(true);
    expect(isSilentDecision(' <沉默> \n')).toBe(true);
    expect(isSilentDecision('【沉默】')).toBe(true);
    expect(isSilentDecision('沉默')).toBe(true);
    expect(isSilentDecision('')).toBe(true);
    expect(isSilentDecision('我认为这个方案有待商榷')).toBe(false);
  });
});

describe('订阅模式: 去中心心跳引擎与编排器集成 (SubscribeEngine & Orchestrator)', () => {
  function makeTestSetup(opts: {
    replies?: Record<string, string>;
  } = {}) {
    const room: RoomConfig = {
      id: 'r_sub',
      name: '订阅测试房',
      topic: '订阅模式测试',
      chainBudget: 3,
      speechLength: 'short',
      toolPermission: 'readonly',
      mode: 'subscribe',
      subscribeConfig: {
        heartbeatIntervalMs: 20, // 测试中极快心跳
      },
      members: [
        { id: 'm1', name: '架构师', adapter: 'mock', persona: '架构师立场', color: '#111' },
        { id: 'm2', name: '工程师', adapter: 'mock', persona: '工程师立场', color: '#222' },
      ],
      createdAt: 1,
    };

    const messages: ChatMessage[] = [];
    const sysMessages: string[] = [];

    const adapter: AgentAdapter = {
      speak: (req) => {
        const text = opts.replies?.[req.member] ?? '测试观点阐述';
        return {
          done: Promise.resolve({ status: 'ok', result: text, durationMs: 10 }),
          cancel: vi.fn(),
        };
      },
    };

    const orch = new Orchestrator({
      room,
      adapterConfigs: { mock: { command: 'mock', args: [] } },
      resolveAdapter: () => adapter,
      pushMessage: (msg) => {
        messages.push(msg);
        return Promise.resolve();
      },
      sysMessage: (text) => {
        sysMessages.push(text);
        return Promise.resolve();
      },
      onStatuses: () => {},
      persistRoom: () => Promise.resolve(),
      runScout: () => Promise.resolve(null),
      getHistory: () => messages,
      pushAgentEvent: () => {},
    });

    return { room, orch, messages, sysMessages };
  }

  it('自决输出 <沉默> 时，绝不落库、不发消息给用户', async () => {
    const { orch, messages } = makeTestSetup({
      replies: {
        m1: '<沉默>',
        m2: '<沉默>',
      },
    });

    await orch.onUserMessage('大家有什么看法？');
    // 等待心跳触发完成
    await new Promise((r) => setTimeout(r, 60));

    // 验证除了用户消息外，两个 Agent 没有生成任何垃圾消息
    const agentMsgs = messages.filter((m) => m.from === 'm1' || m.from === 'm2');
    expect(agentMsgs.length).toBe(0);

    await orch.stop();
  });

  it('Agent 积极发言并支持私聊尾行解析与受众隔离', async () => {
    const { orch, messages } = makeTestSetup({
      replies: {
        m1: '我赞成这个方案！<私聊>@工程师',
        m2: '<沉默>',
      },
    });

    await orch.onUserMessage('方案讨论启动');
    await new Promise((r) => setTimeout(r, 60));

    const m1Msg = messages.find((m) => m.from === 'm1');
    if (m1Msg) {
      expect(m1Msg.text).toBe('我赞成这个方案！');
      expect(m1Msg.audience).toEqual(['m2']);
    }

    await orch.stop();
  });

  it('stop() 彻底清理所有心跳 Timer 与状态', async () => {
    const { orch, room } = makeTestSetup();
    await orch.onUserMessage('启动讨论');
    expect(orch.state).toBe('subscribe');

    await orch.stop();
    expect(orch.state).toBe('idle');
  });

  it('用户消息与 stop 不清空私聊协议:线程与 3 条硬闸计数跨用户消息存活(D4)', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // 随机起手恒选 m1
    try {
      const { orch } = makeTestSetup({
        replies: {
          m1: '<私聊>@工程师 咱们密谋一下',
          m2: '<私聊>@架构师 好,听你的',
        },
      });
      await orch.onUserMessage('开始讨论');
      await new Promise((r) => setTimeout(r, 80));

      // 用户插话(旧行为:start()→stop()→protocol.clear() 把线程全清,硬闸被重置)
      await orch.onUserMessage('我插一句,你们继续');
      await new Promise((r) => setTimeout(r, 60));

      // 协议应仍持有 m1↔m2 的活跃线程且计数延续(≥1,未被清零)
      const protocol = orch['subscribeEngine']['protocol'];
      const thread = protocol.getActiveThread('m1');
      expect(thread).toBeDefined();
      expect(thread!.initiatorId === 'm1' || thread!.targetId === 'm1').toBe(true);
      expect(thread!.count).toBeGreaterThanOrEqual(1);

      // stop 也不清协议
      await orch.stop();
      expect(protocol.getActiveThread('m1')).toBeDefined();

      // 显式清空(clearMessages 语义)才全清
      orch.clearPrivateProtocol();
      expect(protocol.getActiveThread('m1')).toBeUndefined();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('成员移除关闭其参与的私聊线程(编排器集成)', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // 随机起手恒选 m1
    try {
      const { orch } = makeTestSetup({
        replies: { m1: '<私聊>@工程师 密谋开始' },
      });
      await orch.onUserMessage('开始');
      await new Promise((r) => setTimeout(r, 80));

      const protocol = orch['subscribeEngine']['protocol'];
      expect(protocol.getActiveThread('m1')).toBeDefined();

      orch.memberRemoved('m2'); // 工程师退场
      expect(protocol.getActiveThread('m1')).toBeUndefined(); // 线程随对端关闭
    } finally {
      randomSpy.mockRestore();
    }
  });

  describe('公聊/私聊双气泡拆解与自私聊杜绝', () => {
    const members = [
      { id: 'm1', name: '吕布' },
      { id: 'm2', name: '吕布2' },
      { id: 'm3', name: '吕布3' },
    ];

    it('公聊与私聊混杂时成功拆分为公聊与私聊两个部分', () => {
      const text =
        '公开发言部分：吕布1，尔说某“孤身一人”？呵，白门楼曹孟德也这般笃定！\n\n<私聊>@吕布2 兄台私信道来，某听明白了——你我联手，同投吕布1！';
      const result = splitPublicAndPrivateMessage(text, members, 'm3');
      expect(result.publicText).toContain('尔说某“孤身一人”');
      expect(result.publicText).not.toContain('公开发言部分');
      expect(result.publicText).not.toContain('<私聊>');
      expect(result.privateText).toContain('兄台私信道来');
      expect(result.targetMemberIds).toEqual(['m2']);
    });

    it('纯公聊发言无私聊内容', () => {
      const text = '哈哈哈！天下吕奉先，唯有一个！';
      const result = splitPublicAndPrivateMessage(text, members, 'm2');
      expect(result.publicText).toBe(text);
      expect(result.privateText).toBeUndefined();
      expect(result.targetMemberIds).toBeUndefined();
    });

    it('纯私聊发言无公聊内容', () => {
      const text = '<私聊>@吕布2 老三，私下里就不必客套了。';
      const result = splitPublicAndPrivateMessage(text, members, 'm1');
      expect(result.publicText).toBeUndefined();
      expect(result.privateText).toBe('老三，私下里就不必客套了。');
      expect(result.targetMemberIds).toEqual(['m2']);
    });

    it('严禁给自己发私聊: 尝试私聊自己时降级为公聊，不产生私聊', () => {
      const text = '给自己私聊<私聊>@吕布 悄悄话';
      const result = splitPublicAndPrivateMessage(text, members, 'm1'); // m1 是吕布自己
      // 目标吕布被排除，降级为公聊
      expect(result.privateText).toBeUndefined();
      expect(result.targetMemberIds).toBeUndefined();
    });

    it('matchMemberByName 支持数字序号容错纠偏 (@吕布1 命中 吕布)', () => {
      const hit = matchMemberByName('吕布1', members);
      expect(hit).toBeDefined();
      expect(hit?.id).toBe('m1');
      expect(hit?.name).toBe('吕布');
    });

    it('startThread 严禁 initiatorId === targetId', () => {
      const protocol = new PrivateChatProtocol();
      expect(() => protocol.startThread('m1', 'm1')).toThrow('禁止对自己发起私聊');
    });

    it('剥离私聊正文中的握手标签，并正确返回 handshake 类型', () => {
      const textAgree = '<私聊>@吕布2 成交，投票投吕布！\n\n<同意>';
      const resAgree = splitPublicAndPrivateMessage(textAgree, members, 'm3');
      expect(resAgree.privateText).toBe('成交，投票投吕布！');
      expect(resAgree.privateText).not.toContain('<同意>');
      expect(resAgree.handshake).toBe('agree');

      const textIdea = '<私聊>@吕布2 紧急军情，老三速看！\n\n<想法> @吕布2';
      const resIdea = splitPublicAndPrivateMessage(textIdea, members, 'm3');
      expect(resIdea.privateText).toBe('紧急军情，老三速看！');
      expect(resIdea.privateText).not.toContain('<想法>');
      expect(resIdea.handshake).toBe('idea');
    });

    it('支持将同一发言中的多个独立私聊块拆分为多个独立的 privateBlocks 气泡', () => {
      const text =
        '诸位，局势已明。\n\n' +
        '<私聊>@吕布3 老伙计，你的算盘就是我的算盘，我投那个2。<同意>\n\n' +
        '<私聊>@吕布2 老二睡了没？老三方才私下来寻我，要联手投你下油锅，你我联手齐投老三。';
      const result = splitPublicAndPrivateMessage(text, members, 'm1');
      expect(result.publicText).toBe('诸位，局势已明。');
      expect(result.privateBlocks).toHaveLength(2);

      // 第一个私聊气泡发给 m3 (吕布3)
      expect(result.privateBlocks[0]!.targetMemberIds).toEqual(['m3']);
      expect(result.privateBlocks[0]!.privateText).toBe('老伙计，你的算盘就是我的算盘，我投那个2。');
      expect(result.privateBlocks[0]!.handshake).toBe('agree');

      // 第二个私聊气泡发给 m2 (吕布2)
      expect(result.privateBlocks[1]!.targetMemberIds).toEqual(['m2']);
      expect(result.privateBlocks[1]!.privateText).toContain('老二睡了没？');
      expect(result.privateBlocks[1]!.privateText).not.toContain('老伙计');
    });

    it('A与B之间双向复用同一个 active thread', () => {
      const protocol = new PrivateChatProtocol();
      const t1 = protocol.startThread('m1', 'm2');
      // m2 尝试发起针对 m1 的私聊
      const t2 = protocol.startThread('m2', 'm1');
      expect(t1.threadId).toBe(t2.threadId);
    });

    it('订阅模式下用户发纯文本立即随机唤醒一名角色入队响应', async () => {
      const setup = makeTestSetup();
      await setup.orch.onUserMessage('这是用户的纯文本消息');
      expect(setup.orch.state).toBe('subscribe');
      // 检查系统通知中提示唤醒了成员
      expect(setup.sysMessages.some((m) => m.includes('随机唤醒'))).toBe(true);
      await setup.orch.stop();
    });

    it('订阅模式下用户同时 @ 多名角色时依次排队响应', async () => {
      const setup = makeTestSetup();
      await setup.orch.onUserMessage('你们看这个方案如何？@架构师 @工程师');
      expect(setup.orch.state).toBe('subscribe');
      expect(setup.sysMessages.some((m) => m.includes('已唤醒 @架构师 @工程师'))).toBe(true);
      await setup.orch.stop();
    });

    it('外部正在发言的成员不会自己排自己的队，且群里最后发言是自己时心跳自动避让', async () => {
      let speakCount = 0;
      const setup = makeTestSetup();
      const engine = new SubscribeEngine({
        getRoom: () => setup.room,
        getHistory: () => setup.messages,
        isBusy: () => false,
        speak: async () => {
          speakCount++;
          return { status: 'ok', result: '这是一条心跳发言' };
        },
        publishMessage: async (msg) => {
          setup.messages.push({
            id: 'h-' + Date.now(),
            roomId: setup.room.id,
            from: msg.from,
            fromName: msg.fromName,
            text: msg.text,
            ts: Date.now(),
          });
        },
        consumeBudget: () => true,
        sysMessage: async () => {},
        onMentioned: async () => {},
        onIdle: () => {},
      });

      engine.start(setup.room.members);
      // 模拟外部正在由 m1 (吕布) 发言
      engine.setExternalSpeaking(true, 'm1');

      // 尝试触发 m1 的心跳，应被禁止自排队
      // @ts-expect-error 测试私有方法
      await engine.runHeartbeatTick(setup.room.members[0]!);
      // @ts-expect-error 测试私有属性
      expect(engine.speakerQueue.some((m) => m.id === 'm1')).toBe(false);

      // 模拟外部发言完毕，群里最后一条消息是 m1 发出的
      engine.setExternalSpeaking(false);
      setup.messages.push({
        id: 'h-last',
        roomId: setup.room.id,
        from: 'm1',
        fromName: '吕布',
        text: '我刚才发表了观点',
        ts: Date.now(),
      });

      // m1 心跳再次触发，应触发防自连击避让，不产生发言
      // @ts-expect-error 测试私有方法
      await engine.runHeartbeatTick(members[0]);
      expect(speakCount).toBe(0);

      engine.stop();
      await setup.orch.stop();
    });

    it('心跳自决输出 <跳过> 时，零落库并发出系统通知', async () => {
      const sysNotices: string[] = [];
      const messages: any[] = [];
      const room = {
        id: 'test-room',
        name: '测试房',
        topic: '测试话题',
        mode: 'subscribe' as const,
        chainBudget: 6,
        speechLength: 'normal' as const,
        toolPermission: 'readonly' as const,
        createdAt: Date.now(),
        members: [
          { id: 'm1', name: '吕布', adapter: 'mock', persona: '吕布', color: '#fff' },
          { id: 'm2', name: '张飞', adapter: 'mock', persona: '张飞', color: '#fff' },
        ],
      };

      const engine = new SubscribeEngine({
        getRoom: () => room,
        getHistory: () => messages,
        isBusy: () => false,
        speak: async () => ({ status: 'ok', result: '<跳过>' }),
        publishMessage: async (m) => { messages.push(m); },
        consumeBudget: () => true,
        sysMessage: async (text) => { sysNotices.push(text); },
        onMentioned: async () => {},
        onIdle: () => {},
      });

      // 塞一条历史消息
      messages.push({ id: 'm-0', roomId: room.id, from: 'user', text: '大家好', ts: Date.now() });

      engine.start(room.members);
      // @ts-expect-error 测试私有方法
      await engine.runHeartbeatTick(room.members[0]);

      // 验证没有生成聊天气泡，但记录了系统通知
      expect(messages.length).toBe(1); // 只有用户消息
      expect(sysNotices.some((s) => s.includes('吕布 评估暂无发言与私聊意向，选择跳过'))).toBe(true);

      engine.stop();
    });

    it('私聊支持同时指定多个受众: <私聊>@张飞 @产品经理 密谋内容', () => {
      const text = '公开部分\n\n<私聊>@张飞 @产品经理 我们暗中联手吧！';
      const res = splitPublicAndPrivateMessage(text, [
        { id: 'm1', name: '吕布' },
        { id: 'm2', name: '张飞' },
        { id: 'm3', name: '产品经理' },
      ], 'm1');

      expect(res.publicText).toBe('公开部分');
      expect(res.privateText).toBe('我们暗中联手吧！');
      expect(res.targetMemberIds).toEqual(expect.arrayContaining(['m2', 'm3']));
      expect(res.targetMemberIds?.length).toBe(2);
    });

    it('SubscribeEngine.resolvePrivateMeta 统一管理私聊状态与轮次', () => {
      const room = {
        id: 'test-room',
        name: '测试房',
        topic: '测试话题',
        mode: 'subscribe' as const,
        chainBudget: 6,
        speechLength: 'normal' as const,
        toolPermission: 'readonly' as const,
        createdAt: Date.now(),
        members: [
          { id: 'm1', name: '吕布', adapter: 'mock', persona: '吕布', color: '#fff' },
          { id: 'm2', name: '张飞', adapter: 'mock', persona: '张飞', color: '#fff' },
        ],
      };
      const engine = new SubscribeEngine({
        getRoom: () => room,
        getHistory: () => [],
        isBusy: () => false,
        speak: async () => ({ status: 'ok' }),
        publishMessage: async () => {},
        consumeBudget: () => true,
        sysMessage: async () => {},
        onMentioned: async () => {},
        onIdle: () => {},
      });

      // 1. 发起私聊
      const meta1 = engine.resolvePrivateMeta('m1', 'm2');
      expect(meta1.privateRound).toBe(1);
      expect(meta1.privateAction).toBe('start');

      // 2. 对方回复 <同意>
      const meta2 = engine.resolvePrivateMeta('m2', 'm1', 'agree');
      expect(meta2.privateRound).toBe(1);
      expect(meta2.privateAction).toBe('agree');
      expect(meta2.threadId).toBe(meta1.threadId);
      engine.stop();
    });

    it('心跳发言包含公聊和两个私聊分块时，SubscribeEngine 依次发布3条独立气泡消息', async () => {
      const published: any[] = [];
      const room = {
        id: 'test-room',
        name: '测试房',
        topic: '测试话题',
        mode: 'subscribe' as const,
        chainBudget: 6,
        speechLength: 'normal' as const,
        toolPermission: 'readonly' as const,
        createdAt: Date.now(),
        members: [
          { id: 'm1', name: '曹操1', adapter: 'mock', persona: '曹操', color: '#fff' },
          { id: 'm2', name: '曹操2', adapter: 'mock', persona: '曹操', color: '#fff' },
          { id: 'm3', name: '曹操3', adapter: 'mock', persona: '曹操', color: '#fff' },
        ],
      };

      const engine = new SubscribeEngine({
        getRoom: () => room,
        getHistory: () => [{ id: 'init', roomId: 'test-room', from: 'user', fromName: '用户', text: '开局', ts: 1 }],

        isBusy: () => false,
        speak: async () => ({
          status: 'ok',
          result:
            '公聊：天下大势分久必合！\n\n' +
            '<私聊>@曹操3 老三，我们联手投老二。<同意>\n\n' +
            '<私聊>@曹操2 老二睡了没？老三要投你，我们联手反击！',
        }),
        publishMessage: async (msg) => {
          published.push(msg);
        },
        consumeBudget: () => true,
        sysMessage: async () => {},
        onMentioned: async () => {},
        onIdle: () => {},
      });

      // @ts-expect-error 测试私有方法
      await engine.runHeartbeatTick(room.members[0]);

      // 验证一共发布了 3 条独立气泡消息
      expect(published).toHaveLength(3);

      // 1. 公聊消息
      expect(published[0].text).toBe('天下大势分久必合！');
      expect(published[0].audience).toBeUndefined();

      // 2. 私聊气泡 1 (发给曹操3)
      expect(published[1].text).toBe('老三，我们联手投老二。');
      expect(published[1].audience).toEqual(['m3']);
      expect(published[1].handshake).toBe('agree');

      // 3. 私聊气泡 2 (发给曹操2)
      expect(published[2].text).toBe('老二睡了没？老三要投你，我们联手反击！');
      expect(published[2].audience).toEqual(['m2']);

      engine.stop();
    });
  });
});
