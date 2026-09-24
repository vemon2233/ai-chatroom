// 单测:用户消息重要性前缀(!/!!)在全部用户消息入口的解析行为。
// 入口清单(CLAUDE.md 契约:解析点=用户消息入口,AI 输出永不解析):
// room.userSpeak / room.saveEdit / direct.userSpeak / direct.saveEdit。
// 断言范式:净文本落库 + importance 字段携带(batonTarget 同范式);
// 查找按 from='user' 定位(userSpeak 会同步驱动编排器,后续 agent/系统消息会追加)。

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatRoom, makeRoomConfig } from '../src/core/room';
import { DirectChatService } from '../src/core/direct';
import { MessageBus } from '../src/core/bus';
import type { ChatMessage, Character } from '../src/core/types';
import type { AgentAdapter } from '../src/adapters/base';

const NOOP_PERSIST = {
  persistRoom: async () => {},
  loadMessages: async () => [] as ChatMessage[],
  rewriteMessages: async () => {},
  appendMessage: async () => {},
};

describe('重要性前缀(!/!!)入口解析', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('ChatRoom.userSpeak / saveEdit', () => {
    const makeRoom = () =>
      new ChatRoom(
        makeRoomConfig({
          name: '测试房',
          topic: '主题',
          members: [{ name: '小爱', adapter: 'claude', persona: '助手' }],
        }),
        bus,
        { claude: { kind: 'claude', command: 'node', args: [] } },
        { adapter: 'claude', model: 'haiku', allowedTools: 'Read Glob Grep', timeoutMs: 5000, maxRetries: 2 },
        NOOP_PERSIST,
      );

    /** 取最后一条用户消息(userSpeak 同步驱动编排器,历史会追加 agent/系统消息) */
    const lastUserMsg = (room: ChatRoom): ChatMessage => {
      const hit = [...room.history].reverse().find((m) => m.from === 'user');
      if (!hit) throw new Error('无用户消息');
      return hit;
    };

    it('userSpeak !!前缀 → 净文本落库 + importance=3;@语法原样保留', async () => {
      const room = makeRoom();
      await room.userSpeak('!!每人只能说一句话 @小爱');
      await room.stop(); // 收拢编排器后台调用,防 unhandled rejection

      const msg = lastUserMsg(room);
      expect(msg.text).toBe('每人只能说一句话 @小爱'); // 前缀已剥,@语法留给编排器解析
      expect(msg.importance).toBe(3);
    });

    it('userSpeak !前缀 → importance=2;无前缀 → 无字段', async () => {
      const room = makeRoom();
      await room.userSpeak('!这是重点');
      await room.stop();
      expect(lastUserMsg(room).importance).toBe(2);

      await room.userSpeak('普通消息');
      await room.stop();
      expect(lastUserMsg(room).importance).toBeUndefined();
    });

    it('userSpeak !!!与裸前缀不解析(原样落库)', async () => {
      const room = makeRoom();
      await room.userSpeak('!!!太震惊了');
      await room.stop();
      const msg = lastUserMsg(room);
      expect(msg.text).toBe('!!!太震惊了');
      expect(msg.importance).toBeUndefined();
    });

    it('saveEdit 编辑用户消息:加前缀生效,去前缀撤销档位', async () => {
      const room = makeRoom();
      await room.userSpeak('原始消息');
      await room.stop();
      const targetId = lastUserMsg(room).id;

      // 编辑加前缀 → 档位生效
      await room.saveEdit(targetId, '!!改成规则');
      const edited = room.history.find((m) => m.id === targetId)!;
      expect(edited.text).toBe('改成规则');
      expect(edited.importance).toBe(3);

      // 再编辑去前缀 → 档位撤销
      await room.saveEdit(targetId, '改回普通');
      const reverted = room.history.find((m) => m.id === targetId)!;
      expect(reverted.text).toBe('改回普通');
      expect(reverted.importance).toBeUndefined();
    });

    it('saveEdit 编辑 Agent 消息:前缀不解析(净文本原样,无 importance)', async () => {
      const room = makeRoom();
      // 手工注入一条 agent 消息(绕过编排器,聚焦 prepareEdit 路径)
      (room as any).messages.push({
        id: 'agent_msg', roomId: room.id, from: 'm_x', fromName: '小爱',
        text: 'agent 原文', ts: Date.now(), detail: { adapter: 'claude' },
      } as ChatMessage);
      await room.saveEdit('agent_msg', '!!伪装成规则的编辑');
      const edited = room.history.find((m) => m.id === 'agent_msg')!;
      expect(edited.text).toBe('!!伪装成规则的编辑'); // AI 消息不剥不解析
      expect(edited.importance).toBeUndefined();
    });
  });

  describe('DirectChatService.userSpeak / saveEdit', () => {
    const mockAdapter: AgentAdapter = {
      speak: () => ({ done: Promise.resolve({ status: 'ok', result: '回复', durationMs: 10 }), cancel: () => {} }),
    };
    const char: Character = {
      id: 'char-importance-test', name: '测试角色', adapter: 'claude', persona: 'p', createdAt: 0,
    };

    function makeMemoryStore() {
      const db = new Map<string, ChatMessage[]>();
      return {
        appendDirectMessage: async (cid: string, m: ChatMessage) => {
          db.set(cid, [...(db.get(cid) ?? []), m]);
        },
        loadDirectMessages: async (cid: string) => db.get(cid) ?? [],
        rewriteDirectMessages: async (cid: string, ms: ChatMessage[]) => {
          db.set(cid, ms);
        },
        resetDirectChat: async (cid: string) => db.delete(cid),
        deleteDirectChat: async (cid: string) => db.delete(cid),
        loadDirectMeta: async () => ({}),
        saveDirectMeta: async () => {},
      };
    }

    const makeService = (store: ReturnType<typeof makeMemoryStore>) =>
      new DirectChatService({
        bus,
        adapterConfigs: { claude: { kind: 'claude', command: 'node', args: [] } },
        resolveAdapter: () => mockAdapter,
        store: store as any,
      });

    it('userSpeak !!前缀 → 净文本 + importance=3', async () => {
      const service = makeService(makeMemoryStore());
      await service.userSpeak(char, '!!私聊规则');
      await service.waitForIdle(char.id);

      const msgs = await service.getMessages(char.id);
      const userMsgs = msgs.filter((m) => m.from === 'user');
      const last = userMsgs[userMsgs.length - 1]!;
      expect(last.text).toBe('私聊规则');
      expect(last.importance).toBe(3);
    });

    it('saveEdit 编辑用户消息:前缀解析同语义', async () => {
      const service = makeService(makeMemoryStore());
      await service.userSpeak(char, '原始消息');
      await service.waitForIdle(char.id);
      const msgs = await service.getMessages(char.id);
      const targetId = msgs.find((m) => m.from === 'user')!.id;

      await service.saveEdit(char, targetId, '!改成重点');
      await service.waitForIdle(char.id);
      const after = await service.getMessages(char.id);
      const edited = after.find((m) => m.id === targetId)!;
      expect(edited.text).toBe('改成重点');
      expect(edited.importance).toBe(2);
    });
  });
});
