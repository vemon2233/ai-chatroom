import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentEvent } from '../adapters/base';
import type { AgentTraceLog, Character, ChatMessage, DiscussionSummary } from './types';
import type { MessageBus } from './bus';
import { historyText } from './prompt';
import {
  appendDirectMessage,
  loadDirectMessages,
  rewriteDirectMessages,
  resetDirectChat,
  deleteDirectChat,
} from '../store/directChats';
import { truncateMessages, prepareReroll, prepareEdit } from './historyOps';
import { saveTrace } from '../store/trace';
import { getSummary, saveSummary } from '../store/summary';
import type { Admin } from './admin';

export interface DirectChatServiceDeps {
  bus: MessageBus;
  adapterConfigs: Record<string, { kind: string; command: string; args: string[] }>;
  resolveAdapter: (adapterKey: string) => AgentAdapter;
  admin?: Admin;
}

interface ActiveDirectRun {
  cancel: () => void;
  done: Promise<any>;
}

export class DirectChatService {
  private activeRuns = new Map<string, ActiveDirectRun>();
  private sessionIds = new Map<string, string>(); // characterId -> CLI session id
  private summaries = new Map<string, DiscussionSummary>();

  constructor(private deps: DirectChatServiceDeps) {}

  async getMessages(characterId: string): Promise<ChatMessage[]> {
    return await loadDirectMessages(characterId);
  }

  async reset(characterId: string): Promise<void> {
    this.stop(characterId);
    this.sessionIds.delete(characterId);
    await resetDirectChat(characterId);
    this.deps.bus.emitDirectReset(characterId);
  }

  async delete(characterId: string): Promise<void> {
    this.stop(characterId);
    this.sessionIds.delete(characterId);
    await deleteDirectChat(characterId);
  }

  stop(characterId: string): void {
    const active = this.activeRuns.get(characterId);
    if (active) {
      active.cancel();
      this.activeRuns.delete(characterId);
    }
  }

  /** 截断指定消息之后的所有后续私聊消息(点击编辑时截断) */
  async truncateAfter(characterId: string, messageId: string): Promise<ChatMessage[]> {
    this.stop(characterId);
    const msgs = await loadDirectMessages(characterId);
    const remaining = truncateMessages(msgs, messageId);
    await rewriteDirectMessages(characterId, remaining);
    this.deps.bus.emitDirectMessages(characterId, remaining);
    return remaining;
  }

  private runningReplies = new Map<string, Promise<void>>();

  /** 等待指定角色的私聊回复完成(若无正在进行的回复则立即返回) */
  async waitForIdle(characterId: string): Promise<void> {
    const task = this.runningReplies.get(characterId);
    if (task) {
      await task;
    }
  }

  /** 重roll:停止进行中任务,清除该条及后续消息,重新调度该角色回复 */
  async reroll(character: Character, messageId: string): Promise<void> {
    this.stop(character.id);
    this.sessionIds.delete(character.id);
    const msgs = await loadDirectMessages(character.id);
    const { remaining } = prepareReroll(msgs, messageId);
    await rewriteDirectMessages(character.id, remaining);
    this.deps.bus.emitDirectMessages(character.id, remaining);
    void this.generateReply(character, remaining);
  }

  /** 保存编辑:更新消息文本,若是用户发言则重置 session 并重新触发角色回答 */
  async saveEdit(character: Character, messageId: string, newText: string): Promise<void> {
    this.stop(character.id);
    const msgs = await loadDirectMessages(character.id);
    const { remaining, isUser } = prepareEdit(msgs, messageId, newText);
    await rewriteDirectMessages(character.id, remaining);
    this.deps.bus.emitDirectMessages(character.id, remaining);
    if (isUser) {
      this.sessionIds.delete(character.id);
      void this.generateReply(character, remaining);
    }
  }

  /** 用户在 1v1 私聊中直接发言 */
  async userSpeak(character: Character, userText: string): Promise<void> {
    this.stop(character.id);

    const userMsg: ChatMessage = {
      id: randomUUID(),
      roomId: `direct_${character.id}`,
      from: 'user',
      fromName: '用户',
      text: userText,
      ts: Date.now(),
    };
    await appendDirectMessage(character.id, userMsg);
    this.deps.bus.emitDirectMessage(character.id, userMsg);

    const history = await loadDirectMessages(character.id);
    void this.generateReply(character, history);
  }

  /** 执行适配器调用并生成回复流 */
  private generateReply(character: Character, history: ChatMessage[]): Promise<void> {
    const task = (async () => {
      const acfg = this.deps.adapterConfigs[character.adapter];
    if (!acfg) {
      const errText = `适配器未配置: ${character.adapter}`;
      const sysMsg: ChatMessage = {
        id: randomUUID(),
        roomId: `direct_${character.id}`,
        from: 'system',
        fromName: '系统',
        text: errText,
        ts: Date.now(),
        system: true,
      };
      await appendDirectMessage(character.id, sysMsg);
      this.deps.bus.emitDirectMessage(character.id, sysMsg);
      return;
    }

    const adapter = this.deps.resolveAdapter(acfg.kind ?? character.adapter);

    const prompt = [
      `你是 ${character.name}。`,
      `你的人设与立场如下:\n${character.persona}`,
      `现在你正在与用户进行一对一的专属私聊。请完全符合你的人设特点，自然、真诚地回复用户的提问或探讨。`,
      `\n以下是你们此前的对话记录:\n${historyText(history, 30)}`,
      `\n请回复用户:`,
    ].join('\n\n');

    const trace: import('./types').TraceEntry[] = [];
    let thinking = '';
    let usage: NonNullable<ChatMessage['detail']>['usage'] = undefined;

    const resumeSessionId = this.sessionIds.get(character.id);
    const req: import('../adapters/base').SpeakRequest = {
      member: character.id,
      prompt,
      command: acfg.command,
      args: [...acfg.args, ...(character.extraArgs ?? [])],
      resumeSessionId,
      permission: 'readonly',
    };

    const handle = adapter.speak(req, (ev: AgentEvent) => {
      if (ev.sessionId) {
        this.sessionIds.set(character.id, ev.sessionId);
      }
      if (ev.phase === 'thinking') {
        if (ev.thinkingDelta) {
          thinking += ev.thinkingDelta;
          trace.push({ kind: 'thinking', ts: Date.now(), content: ev.thinkingDelta });
        }
      } else if (ev.phase === 'streaming' && ev.textDelta) {
        trace.push({ kind: 'text', ts: Date.now(), content: ev.textDelta });
      } else if (ev.phase === 'done') {
        usage = ev.usage;
      }
      this.deps.bus.emitDirectEvent(character.id, ev);
    });

    this.activeRuns.set(character.id, { cancel: handle.cancel, done: handle.done });

    let outcome;
    try {
      outcome = await handle.done;
    } finally {
      this.activeRuns.delete(character.id);
    }

    const recordTrace = (messageId: string, outputText: string) => {
      const traceLog: AgentTraceLog = {
        messageId,
        roomId: `direct_${character.id}`,
        memberId: character.id,
        memberName: character.name,
        adapter: character.adapter,
        ts: Date.now(),
        durationMs: outcome.durationMs,
        status: outcome.status,
        error: outcome.error,
        trigger: '1v1用户对话',
        input: {
          prompt,
          command: req.command,
          args: req.args,
          cwd: req.cwd,
          resumeSessionId: req.resumeSessionId,
        },
        output: {
          result: outputText,
          thinking: thinking || undefined,
          trace: trace ?? [],
          usage,
        },
      };
      void saveTrace('direct', character.id, traceLog);
    };

    if (outcome.status === 'cancelled') {
      const streamed = trace
        .filter((t) => t.kind === 'text')
        .map((t) => t.content)
        .join('');
      const text = streamed.trim() || '(已停止思考)';
      const msgId = randomUUID();
      recordTrace(msgId, text);
      const cancelledMsg: ChatMessage = {
        id: msgId,
        roomId: `direct_${character.id}`,
        from: character.id,
        fromName: character.name,
        text,
        ts: Date.now(),
        detail: {
          trace,
          thinking: thinking || undefined,
          durationMs: outcome.durationMs,
          adapter: character.adapter,
          hasTrace: true,
        },
      };
      await appendDirectMessage(character.id, cancelledMsg);
      this.deps.bus.emitDirectMessage(character.id, cancelledMsg);
      return;
    }

    if (outcome.status === 'error') {
      const errMsg: ChatMessage = {
        id: randomUUID(),
        roomId: `direct_${character.id}`,
        from: 'system',
        fromName: '系统',
        text: `${character.name} 回复失败: ${outcome.error ?? '未知错误'}`,
        ts: Date.now(),
        system: true,
      };
      await appendDirectMessage(character.id, errMsg);
      this.deps.bus.emitDirectMessage(character.id, errMsg);
      return;
    }

      // ok
      const text = outcome.result || '(无输出)';
      const msgId = randomUUID();
      recordTrace(msgId, text);
      const botMsg: ChatMessage = {
        id: msgId,
        roomId: `direct_${character.id}`,
        from: character.id,
        fromName: character.name,
        text,
        ts: Date.now(),
        detail: {
          trace,
          thinking: thinking || undefined,
          usage,
          durationMs: outcome.durationMs,
          adapter: character.adapter,
          hasTrace: true,
        },
      };
      await appendDirectMessage(character.id, botMsg);
      this.deps.bus.emitDirectMessage(character.id, botMsg);
    })();

    this.runningReplies.set(character.id, task);
    return task.finally(() => {
      if (this.runningReplies.get(character.id) === task) {
        this.runningReplies.delete(character.id);
      }
    });
  }

  async getSummary(characterId: string): Promise<DiscussionSummary | null> {
    if (this.summaries.has(characterId)) {
      return this.summaries.get(characterId)!;
    }
    const sum = await getSummary('direct', characterId);
    if (sum) this.summaries.set(characterId, sum);
    return sum;
  }

  async refreshSummary(characterId: string, character: Character): Promise<DiscussionSummary | null> {
    if (!this.deps.admin) return null;
    const msgs = await loadDirectMessages(characterId);
    const res = await this.deps.admin.generateSummary(msgs, `与 ${character.name} 的一对一私聊探讨`);
    if (res && res.text) {
      await saveSummary('direct', characterId, res);
      this.summaries.set(characterId, res);
      this.deps.bus.emitDirectSummary(characterId, res);
    }
    return res;
  }
}

