// 订阅模式: 发言发布管线唯一真源。
// 职责(一次模型调用的原始输出 → 气泡):
//  1. silent 判定——心跳路径合法跳过(发"选择跳过"通知);mustRespond 条目违规跳过
//     (发"点名场景不允许跳过"通知);两种情况均零气泡零落库
//  2. 剥接棒尾行 + 公私混杂拆分 + 兜底(公私皆空时 stripAudienceLine 兜底公聊)
//  3. 发布循环:公聊先发,私聊逐个发(resolvePrivateMeta 算线程元数据)
//  4. traceId 令牌:traceMessageId 只被首气泡消费一次,后续气泡用随机 id
//     (点开首气泡即命中 trace 文件——与 TraceStore 的约定)
// 副作用边界(留调用方):预算扣减/游标更新/markMemberSpoken/maybeCompact/
// persistRoom/trace 落库时机(runOne 先落 trace 再调管线;心跳拿返回值后落)
// 消费方:orchestrator.runOne 订阅分支(队列驱动)与 engine.runHeartbeatTick(心跳驱动)。

import type { ChatMessage, MemberConfig, TraceEntry } from '../../types';
import { randomUUID } from 'node:crypto';
import {
  splitPublicAndPrivateMessage,
  stripAudienceLine,
} from './audience';
import { isSilentDecision } from './prompt';
import { stripBatonLine } from '../baton/baton';

/** 适配器调用详情透传(每个气泡的 detail 字段素材) */
export interface SpeechDetail {
  trace?: TraceEntry[];
  thinking?: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  durationMs?: number;
  adapter: string;
  trigger?: string;
}

export interface SpeechPublishDeps {
  roomId: string;
  /** 拆分候选成员表(排除自己的逻辑在拆分函数内) */
  members: MemberConfig[];
  /** 单气泡发布通道(落库+广播由调用方实现) */
  publish: (msg: ChatMessage) => Promise<void>;
  /** 私聊线程元数据解析(engine 的协议簿记) */
  resolvePrivateMeta: (
    senderId: string,
    targetId: string,
    handshake?: 'agree' | 'reject' | 'idea',
  ) => { threadId: string; privateRound: number; privateAction: 'start' | 'agree' | 'reject' | 'idea' | 'reply' };
  /** 系统消息通道(silent 通知用) */
  sysMessage: (text: string) => Promise<void>;
  /** silent 通知渲染(双语);缺省回退原中文(测试直调兼容) */
  tSilent?: (mustRespond: boolean, name: string) => string;
  /** trace 令牌:首气泡 messageId(与 trace 文件名一致);缺省首气泡用随机 id */
  traceMessageId?: string;
  /** 发布后钩子(心跳传 mentions 扫描;队列路径不传) */
  onPublished?: (
    text: string,
    audience?: string[],
    handshake?: 'agree' | 'reject' | 'idea',
  ) => Promise<void>;
}

export interface PublishedBubble {
  messageId: string;
  text: string;
  audience?: string[];
}

export interface PublishOutcome {
  /** 是否 silent(跳过)——零气泡,调用方据此决定 trace/预算后续 */
  wasSilent: boolean;
  /** 按发布顺序的全部气泡(publishedIds[0] === traceMessageId ?? 随机) */
  publishedIds: string[];
  bubbles: PublishedBubble[];
}

/**
 * 发布一次订阅模式发言的完整管线。
 * @param speaker 发言成员
 * @param rawText 模型原始完整输出(silent 判定与拆分的输入;trace 全文由调用方自行落)
 * @param mustRespond 点名/起头等强制回应条目——跳过属违规,通知措辞不同(prompt 层已禁跳过,此处兜底)
 */
export async function publishSpeechResult(
  speaker: MemberConfig,
  rawText: string,
  detail: SpeechDetail,
  deps: SpeechPublishDeps,
  mustRespond = false,
): Promise<PublishOutcome> {
  // 1. silent 判定:统一必发系统通知(消灭"点名后无声无息"的体验缺陷),零气泡零落库
  if (isSilentDecision(rawText)) {
    const text = deps.tSilent
      ? deps.tSilent(mustRespond, speaker.name)
      : mustRespond
        ? `${speaker.name} 尝试跳过发言(点名场景不允许跳过),本次发言已忽略。`
        : `${speaker.name} 评估暂无发言与私聊意向,选择跳过。`;
    await deps.sysMessage(text);
    return { wasSilent: true, publishedIds: [], bubbles: [] };
  }

  // 2. 剥接棒尾行 + 公私拆分 + 兜底
  const cleaned = stripBatonLine(rawText);
  const split = splitPublicAndPrivateMessage(cleaned, deps.members, speaker.id);
  if (!split.publicText && (!split.privateBlocks || split.privateBlocks.length === 0)) {
    split.publicText = stripAudienceLine(cleaned) || cleaned;
  }

  // 3. 发布循环(traceId 令牌:首气泡消费一次即弃)
  const publishedIds: string[] = [];
  const bubbles: PublishedBubble[] = [];
  let token = deps.traceMessageId;
  const nextId = () => {
    const id = token ?? randomUUID();
    token = undefined;
    return id;
  };

  // 3.1 公聊气泡
  if (split.publicText) {
    const msgId = nextId();
    publishedIds.push(msgId);
    bubbles.push({ messageId: msgId, text: split.publicText });
    await deps.publish({
      id: msgId,
      roomId: deps.roomId,
      from: speaker.id,
      fromName: speaker.name,
      text: split.publicText,
      ts: Date.now(),
      audience: undefined,
      detail: {
        trace: detail.trace,
        thinking: detail.thinking,
        usage: detail.usage,
        durationMs: detail.durationMs,
        adapter: detail.adapter,
        trigger: detail.trigger,
        hasTrace: true,
      },
    });
    await deps.onPublished?.(split.publicText);
  }

  // 3.2 私聊气泡(受众隔离,支持多播与多段)
  for (const block of split.privateBlocks ?? []) {
    const primaryTarget = block.targetMemberIds[0];
    if (!primaryTarget || !block.privateText) continue;

    const meta = deps.resolvePrivateMeta(speaker.id, primaryTarget, block.handshake);
    const msgId = nextId();
    publishedIds.push(msgId);
    bubbles.push({ messageId: msgId, text: block.privateText, audience: block.targetMemberIds });
    await deps.publish({
      id: msgId,
      roomId: deps.roomId,
      from: speaker.id,
      fromName: speaker.name,
      text: block.privateText,
      ts: Date.now(),
      audience: block.targetMemberIds,
      threadId: meta.threadId,
      handshake: block.handshake,
      privateRound: meta.privateRound,
      privateAction: meta.privateAction,
      detail: {
        trace: detail.trace,
        thinking: detail.thinking,
        usage: detail.usage,
        durationMs: detail.durationMs,
        adapter: detail.adapter,
        trigger: detail.trigger,
        hasTrace: true,
      },
    });
    await deps.onPublished?.(block.privateText, block.targetMemberIds, block.handshake);
  }

  return { wasSilent: false, publishedIds, bubbles };
}
