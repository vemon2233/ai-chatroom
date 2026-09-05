import { describe, it, expect, beforeEach } from 'vitest';
import { extractDeltaMessages, buildDeltaPrompt, historyText } from '../src/core/prompt';
import { DirectChatService } from '../src/core/direct';
import { MessageBus } from '../src/core/bus';
import type { ChatMessage, Character, RoomConfig } from '../src/core/types';
import type { AgentAdapter, SpeakOutcome } from '../src/adapters/base';

describe('双上下文模式 (Dual Context Mode) 单元测试', () => {
  describe('extractDeltaMessages 增量切片与锚定判定', () => {
    const msgs: ChatMessage[] = [
      { id: 'm1', roomId: 'r1', from: 'user', fromName: '用户', text: '消息1', ts: 1000 },
      { id: 'm2', roomId: 'r1', from: 'bot1', fromName: '机器人1', text: '消息2', ts: 2000 },
      { id: 'm3', roomId: 'r1', from: 'user', fromName: '用户', text: '消息3', ts: 3000 },
      { id: 'm4', roomId: 'r1', from: 'bot2', fromName: '机器人2', text: '消息4', ts: 4000 },
    ];

    it('无 lastSeenId 时返回全量且 isReanchored 为 true', () => {
      const res = extractDeltaMessages(msgs, undefined);
      expect(res.isReanchored).toBe(true);
      expect(res.delta.length).toBe(4);
    });

    it('有效 lastSeenId 时仅返回其之后的增量消息，且 isReanchored 为 false', () => {
      const res = extractDeltaMessages(msgs, 'm2');
      expect(res.isReanchored).toBe(false);
      expect(res.delta.length).toBe(2);
      expect(res.delta[0]!.id).toBe('m3');
      expect(res.delta[1]!.id).toBe('m4');
    });

    it('lastSeenId 在历史中未找到(被截断或清空)时，降级全量并 isReanchored 为 true', () => {
      const res = extractDeltaMessages(msgs, 'deleted_msg_id');
      expect(res.isReanchored).toBe(true);
      expect(res.delta.length).toBe(4);
    });
  });

  describe('buildDeltaPrompt 增量 Prompt 精简性验证', () => {
    const mockRoom: RoomConfig = {
      id: 'room_1',
      name: '辩论赛',
      topic: 'AI的发展',
      chainBudget: 6,
      speechLength: 'short',
      toolPermission: 'readonly',
      members: [
        { id: 'c1', name: '正方', adapter: 'claude', persona: '正方辩友', color: '#ff0000' },
        { id: 'c2', name: '反方', adapter: 'claude', persona: '反方辩友', color: '#00ff00' },
      ],
      createdAt: Date.now(),
      contextMode: 'stateful',
    };

    const deltaMsgs: ChatMessage[] = [
      { id: 'd1', roomId: 'room_1', from: 'c2', fromName: '反方', text: '对方辩友偷换了概念。', ts: 1000 },
    ];

    it('增量 Prompt 必须包含加粗身份锚点且仅包含增量消息，不重复贴出全景背景', () => {
      const prompt = buildDeltaPrompt(mockRoom, mockRoom.members[0]!, deltaMsgs);
      expect(prompt).toContain('你是 **【正方】**');
      expect(prompt).toContain('**[反方] (全员公聊)：**');
      expect(prompt).toContain('对方辩友偷换了概念');
      // 增量 Prompt 不应重复长篇的 # 讨论主题 与 # 其他参与者 描述
      expect(prompt).not.toContain('# 讨论主题:');
      expect(prompt).not.toContain('# 其他参与者');
    });

    it('historyText 智能区分公聊、私聊密信与 @提及', () => {
      const msgs: ChatMessage[] = [
        { id: '1', roomId: 'r1', from: 'c2', fromName: '反方', text: '公聊消息', ts: 1 },
        { id: '2', roomId: 'r1', from: 'c2', fromName: '反方', text: '密谋对策', ts: 2, audience: ['c1'] },
        { id: '3', roomId: 'r1', from: 'c2', fromName: '反方', text: '请问 @正方 怎么看？', ts: 3 },
      ];
      const formatted = historyText(msgs, 10, 'c1', '正方');
      expect(formatted).toContain('**[反方] (全员公聊)：**\n公聊消息');
      expect(formatted).toContain('> 🔒 **【私聊密信 ── 反方 对 你 悄悄说】：**\n> 密谋对策');
      expect(formatted).toContain('**🎯【@提及了你】[反方] (全员公聊)：**\n请问 @正方 怎么看？');
    });
  });

  describe('DirectChatService: 1v1 私聊在 stateless vs stateful 下的调用行为', () => {
    const bus = new MessageBus();
    const charId = 'test-char-ctx';
    let capturedRequests: any[] = [];

    const mockAdapter: AgentAdapter = {
      speak(req, onEvent) {
        capturedRequests.push(req);
        return {
          cancel: () => {},
          done: (async (): Promise<SpeakOutcome> => {
            onEvent({ member: req.member, phase: 'thinking', sessionId: 'cli-session-abc' });
            onEvent({ member: req.member, phase: 'done', result: '回复内容' });
            return { status: 'ok', result: '回复内容', durationMs: 20 };
          })(),
        };
      },
    };

    const service = new DirectChatService({
      bus,
      adapterConfigs: { mock: { kind: 'mock', command: 'mock', args: [] } },
      resolveAdapter: () => mockAdapter,
    });

    const testChar: Character = {
      id: charId,
      name: '测试助手',
      adapter: 'mock',
      persona: '你是一个聪明的助手',
      createdAt: Date.now(),
    };

    beforeEach(async () => {
      capturedRequests = [];
      await service.reset(charId);
    });

    it('默认 stateless 模式: 即使第二轮对话，也不带 resumeSessionId，传全量历史', async () => {
      service.setContextMode(charId, 'stateless');

      // 第 1 轮
      await service.userSpeak(testChar, '第一句话');
      await service.waitForIdle(charId);
      expect(capturedRequests[0].resumeSessionId).toBeUndefined();
      expect(capturedRequests[0].prompt).toContain('第一句话');

      // 第 2 轮
      await service.userSpeak(testChar, '第二句话');
      await service.waitForIdle(charId);
      expect(capturedRequests[1].resumeSessionId).toBeUndefined();
      expect(capturedRequests[1].prompt).toContain('第一句话');
      expect(capturedRequests[1].prompt).toContain('第二句话');
    });

    it('stateful 模式: 第 1 轮全量冷启动，第 2 轮带 resumeSessionId 且 Prompt 仅包含最新增量', async () => {
      service.setContextMode(charId, 'stateful');

      // 第 1 轮冷启动
      await service.userSpeak(testChar, '第一句话');
      await service.waitForIdle(charId);
      expect(capturedRequests[0].resumeSessionId).toBeUndefined();
      expect(capturedRequests[0].prompt).toContain('你的人设与立场如下');

      // 第 2 轮增量 resume
      await service.userSpeak(testChar, '第二句话');
      await service.waitForIdle(charId);
      expect(capturedRequests[1].resumeSessionId).toBe('cli-session-abc');
      // 增量模式下，Prompt 只包含新增内容，不再包含长篇的人设背景
      expect(capturedRequests[1].prompt).toContain('第二句话');
      expect(capturedRequests[1].prompt).not.toContain('你的人设与立场如下');
    });
  });
});
