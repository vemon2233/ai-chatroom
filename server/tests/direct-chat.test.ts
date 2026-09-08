import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DirectChatService, type DirectChatStore } from '../src/core/direct';
import { MessageBus } from '../src/core/bus';
import type { ChatMessage, Character } from '../src/core/types';
import type { AgentAdapter, SpeakOutcome } from '../src/adapters/base';

/** 内存 fake store(接缝注入——单测不触磁盘) */
function makeMemoryStore(): DirectChatStore & { clear(): void } {
  const db = new Map<string, ChatMessage[]>();
  return {
    clear: () => db.clear(),
    appendDirectMessage: async (id, msg) => {
      (db.get(id) ?? db.set(id, []).get(id)!).push(msg);
    },
    loadDirectMessages: async (id) => [...(db.get(id) ?? [])],
    rewriteDirectMessages: async (id, msgs) => { db.set(id, [...msgs]); },
    resetDirectChat: async (id) => { db.set(id, []); },
    deleteDirectChat: async (id) => { db.delete(id); },
  };
}

describe('DirectChatService: 角色专属 1v1 私聊', () => {
  const bus = new MessageBus();
  const testCharId = 'char-test-unit-1';
  const memStore = makeMemoryStore();

  const mockAdapter: AgentAdapter = {
    speak(req, onEvent) {
      return {
        cancel: () => {},
        done: (async (): Promise<SpeakOutcome> => {
          onEvent({ member: req.member, phase: 'thinking', thinkingDelta: '正在思考...' });
          onEvent({ member: req.member, phase: 'streaming', textDelta: '你好，我是测试角色回复。' });
          onEvent({ member: req.member, phase: 'done', result: '你好，我是测试角色回复。' });
          return {
            status: 'ok',
            result: '你好，我是测试角色回复。',
            durationMs: 50,
          };
        })(),
      };
    },
  };

  const adapterConfigs = {
    testAdapter: { kind: 'mock', command: 'mock', args: [] },
  };

  const service = new DirectChatService({
    bus,
    adapterConfigs,
    resolveAdapter: () => mockAdapter,
    store: memStore,
  });

  const testChar: Character = {
    id: testCharId,
    name: '测试助手',
    adapter: 'testAdapter',
    persona: '你是一个聪明的助手',
    createdAt: Date.now(),
  };

  beforeEach(async () => {
    await service.reset(testCharId);
  });

  it('用户发言后生成回复并广播 directMessage 与 directEvent 事件', async () => {
    const events: any[] = [];
    const spyBroadcast = vi.spyOn(bus, 'broadcast').mockImplementation((ev) => {
      events.push(ev);
    });

    await service.userSpeak(testChar, '你好呀');
    await service.waitForIdle(testCharId);

    const msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.from).toBe('user');
    expect(msgs[0]!.text).toBe('你好呀');
    expect(msgs[1]!.from).toBe(testCharId);
    expect(msgs[1]!.text).toBe('你好，我是测试角色回复。');

    // 验证事件流中包含 directEvent 与 directMessage
    const hasEvent = events.some((e) => e.type === 'directEvent' && e.characterId === testCharId);
    const hasMsg = events.some((e) => e.type === 'directMessage' && e.characterId === testCharId);
    expect(hasEvent).toBe(true);
    expect(hasMsg).toBe(true);

    spyBroadcast.mockRestore();
  });

  it('重置私聊记录后，历史消息清空', async () => {
    await service.userSpeak(testChar, '一条要被清除的消息');
    await service.waitForIdle(testCharId);
    let msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(2);

    await service.reset(testCharId);
    msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(0);
  });

  it('truncateAfter: 截断指定消息之后的内容并广播 directMessages', async () => {
    await service.userSpeak(testChar, '第一句');
    await service.waitForIdle(testCharId);
    let msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(2);

    // 截断在第一句用户消息处
    const userMsgId = msgs[0]!.id;
    const remaining = await service.truncateAfter(testCharId, userMsgId);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.id).toBe(userMsgId);

    msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(1);
  });

  it('reroll: 截断 AI 消息并重新触发生成', async () => {
    await service.userSpeak(testChar, '求重新生成');
    await service.waitForIdle(testCharId);
    let msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(2);
    const botMsgId = msgs[1]!.id;

    await service.reroll(testChar, botMsgId);
    await service.waitForIdle(testCharId);

    msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.from).toBe('user');
    expect(msgs[1]!.from).toBe(testCharId);
    // 新的生成应该赋予新的消息 ID
    expect(msgs[1]!.id).not.toBe(botMsgId);
  });

  it('saveEdit: 修改用户消息后截断并重新驱动回复', async () => {
    await service.userSpeak(testChar, '原始提问');
    await service.waitForIdle(testCharId);
    let msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(2);
    const userMsgId = msgs[0]!.id;

    await service.saveEdit(testChar, userMsgId, '修改后的新提问');
    await service.waitForIdle(testCharId);

    msgs = await service.getMessages(testCharId);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.text).toBe('修改后的新提问');
    expect(msgs[1]!.from).toBe(testCharId);
  });

  it('invalidateSession: 重置缓存的 CLI session', () => {
    // 模拟存在 sessionId 缓存
    (service as any).sessionIds.set(testCharId, 'cli-session-123');
    expect((service as any).sessionIds.get(testCharId)).toBe('cli-session-123');

    service.invalidateSession(testCharId);
    expect((service as any).sessionIds.get(testCharId)).toBeUndefined();
  });
});

