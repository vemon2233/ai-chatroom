import { describe, it, expect, beforeEach } from 'vitest';
import { ChatRoom, makeRoomConfig } from '../src/core/room';
import { DirectChatService } from '../src/core/direct';
import { MessageBus } from '../src/core/bus';
import { parseBaton } from '../src/core/modes/baton/baton';
import type { ChatMessage, DirectChatMeta } from '../src/core/types';

describe('User Persona & Plan A Invariant Audit', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('ChatRoom 方案 A 锁定与发言人设', () => {
    it('消息数 = 0 时允许自由设定和修改 userPersona', async () => {
      const room = new ChatRoom(
        makeRoomConfig({
          name: '测试房间',
          topic: '主题',
          members: [{ name: '小爱', adapter: 'mock', persona: '助手' }],
        }),
        bus,
        { mock: { kind: 'mock', command: 'node', args: [] } },
        { adapter: 'mock', model: 'haiku', allowedTools: 'Read Glob Grep', timeoutMs: 5000, maxRetries: 2 },
        {
          persistRoom: async () => {},
          loadMessages: async () => [],
          rewriteMessages: async () => {},
          appendMessage: async () => {},
        },
      );

      // 1. 开局设定人设为「架构师」
      await room.updateSettings({
        userPersona: {
          name: '架构师',
          persona: '精通高并发架构',
        },
      });
      expect(room.config.userPersona?.name).toBe('架构师');

      // 2. 消息数依然为 0，允许再次换为人设「产品总监」
      await room.updateSettings({
        userPersona: {
          name: '产品总监',
          persona: '把控核心指标',
        },
      });
      expect(room.config.userPersona?.name).toBe('产品总监');
    });

    it('会话产生消息(>0)后，尝试变更 userPersona 即刻触发方案 A 拦截', async () => {
      let savedMessages: ChatMessage[] = [];
      const room = new ChatRoom(
        makeRoomConfig({
          name: '测试房间',
          topic: '主题',
          userPersona: { name: '架构师', persona: '架构设定' },
          members: [{ name: '小爱', adapter: 'claude', persona: '助手' }],
        }),
        bus,
        { claude: { kind: 'claude', command: 'node', args: [] } },
        { adapter: 'claude', model: 'haiku', allowedTools: 'Read Glob Grep', timeoutMs: 5000, maxRetries: 2 },
        {
          persistRoom: async () => {},
          loadMessages: async () => savedMessages,
          rewriteMessages: async (_id, msgs) => { savedMessages = [...msgs]; },
          appendMessage: async (m) => { savedMessages.push(m); },
        },
      );

      // 用户发出第 1 条消息
      await room.userSpeak('你好，我是架构师');
      expect(room.history.length).toBeGreaterThanOrEqual(1);
      const userMsg = room.history.find((m) => m.from === 'user');
      expect(userMsg?.fromName).toBe('架构师'); // 自动对齐用户发言名称

      // 尝试变更身份 -> 触发方案 A 领域拦截抛错
      await expect(
        room.updateSettings({
          userPersona: { name: '体验设计师', persona: 'UI/UX 设定' },
        }),
      ).rejects.toThrow(/当前会话已有消息记录，身份设定已锁定/);

      // 确认原身份未被篡改
      expect(room.config.userPersona?.name).toBe('架构师');

      // 执行清空历史操作 (clearMessages)
      await room.clearMessages();
      expect(room.history.length).toBe(0);

      // 清空后方案 A 自动解冻，允许重新换绑为「体验设计师」
      await room.updateSettings({
        userPersona: { name: '体验设计师', persona: 'UI/UX 设定' },
      });
      expect(room.config.userPersona?.name).toBe('体验设计师');
    });
  });

  describe('接棒交还给用户 (Baton handoff to user)', () => {
    it('parseBaton 正确识别接棒给用户或用户指定人设名称', () => {
      const members = [
        { id: 'm1', name: '后端开发' },
        { id: 'm2', name: '前端开发' },
      ];

      // 1. 接棒给默认「用户」
      const res1 = parseBaton('我的方案讲完了。\n<接棒>@用户', members, 'm1', ['用户', 'user', '架构师']);
      expect(res1.toUser).toBe(true);

      // 2. 接棒给具体人设名「架构师」
      const res2 = parseBaton('架构师请审阅。\n<接棒>@架构师', members, 'm1', ['用户', 'user', '架构师']);
      expect(res2.toUser).toBe(true);

      // 3. 接棒给普通成员「前端开发」
      const res3 = parseBaton('前端请跟进。\n<接棒>@前端开发', members, 'm1', ['用户', 'user', '架构师']);
      expect(res3.toUser).toBeUndefined();
      expect(res3.nextMemberId).toBe('m2');
    });
  });

  describe('1v1 私聊方案 A 锁定与元数据持久化', () => {
    it('无消息时允许设置 meta，有消息后变更被拦截，清空后解锁', async () => {
      let currentMeta: DirectChatMeta = {};
      let messages: ChatMessage[] = [];

      const mockStore = {
        appendDirectMessage: async (_cid: string, msg: ChatMessage) => { messages.push(msg); },
        loadDirectMessages: async () => messages,
        rewriteDirectMessages: async (_cid: string, msgs: ChatMessage[]) => { messages = [...msgs]; },
        resetDirectChat: async () => { messages = []; },
        deleteDirectChat: async () => { messages = []; currentMeta = {}; },
        loadDirectMeta: async () => currentMeta,
        saveDirectMeta: async (_cid: string, meta: DirectChatMeta) => { currentMeta = meta; },
      };

      const directChat = new DirectChatService({
        bus,
        adapterConfigs: { mock: { kind: 'mock', command: 'node', args: [] } },
        resolveAdapter: () => ({
          speak: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'ok', result: 'AI回答' }) }),
        } as any),
        store: mockStore,
      });

      const char = {
        id: 'char-bot-1',
        name: '诗仙李白',
        adapter: 'mock',
        persona: '大唐浪漫主义诗人',
        createdAt: Date.now(),
      };

      // 1. 开局设定私聊身份为「杜甫」
      await directChat.setMeta('char-bot-1', {
        userPersona: { name: '杜甫', persona: '大唐现实主义诗人，心怀天下' },
      });
      expect((await directChat.getMeta('char-bot-1')).userPersona?.name).toBe('杜甫');

      // 2. 用户发言 -> fromName 为「杜甫」
      await directChat.userSpeak(char, '太白兄，别来无恙！');
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0]!.fromName).toBe('杜甫');

      // 3. 有消息后尝试变更私聊身份为「苏轼」-> 触发方案 A 拦截
      await expect(
        directChat.setMeta('char-bot-1', {
          userPersona: { name: '苏轼', persona: '宋代大文豪' },
        }),
      ).rejects.toThrow(/当前会话已有消息记录，身份设定已锁定/);

      // 4. 重置清空私聊 -> 解锁
      await directChat.reset('char-bot-1');
      expect(messages.length).toBe(0);

      // 重新成功设置为「苏轼」
      await directChat.setMeta('char-bot-1', {
        userPersona: { name: '苏轼', persona: '宋代大文豪' },
      });
      expect((await directChat.getMeta('char-bot-1')).userPersona?.name).toBe('苏轼');
    });
  });
});
