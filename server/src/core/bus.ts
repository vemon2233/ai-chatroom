// MessageBus:房间内消息路由 + WebSocket 广播 + JSONL 持久化。
// 服务器全局唯一;编排器经它收发,前端经 ws 收实时事件。

import type { WebSocket } from 'ws';
import type { AgentEvent } from '../adapters/base';
import type { ChatMessage, RoomState } from './types';
import { appendMessage } from '../store/transcript';

/** 推送给前端的事件包 */
export type WsEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'roomMessages'; roomId: string; messages: ChatMessage[] }
  | { type: 'agentEvent'; roomId: string; event: AgentEvent }
  | { type: 'roomState'; roomId: string; state: RoomState }
  | { type: 'roomSummary'; roomId: string; summary: import('./types').DiscussionSummary }
  | { type: 'directMessage'; characterId: string; message: ChatMessage }
  | { type: 'directMessages'; characterId: string; messages: ChatMessage[] }
  | { type: 'directEvent'; characterId: string; event: AgentEvent }
  | { type: 'directSummary'; characterId: string; summary: import('./types').DiscussionSummary }
  | { type: 'directReset'; characterId: string }
  | { type: 'rooms' }
  | { type: 'error'; message: string };

export class MessageBus {
  private clients = new Set<WebSocket>();

  addClient(ws: WebSocket) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
  }

  broadcast(ev: WsEvent) {
    const data = JSON.stringify(ev);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  /** 成员/用户的一条聊天消息:持久化 + 广播。 */
  async emitMessage(msg: ChatMessage) {
    await appendMessage(msg).catch((e) =>
      console.error(`[bus] 持久化失败 room=${msg.roomId}:`, e),
    );
    this.broadcast({ type: 'message', message: msg });
  }

  emitRoomMessages(roomId: string, messages: ChatMessage[]) {
    this.broadcast({ type: 'roomMessages', roomId, messages });
  }

  /** 适配器原始事件(思考中/增量流),只广播不持久化。 */
  emitAgentEvent(roomId: string, event: AgentEvent) {
    this.broadcast({ type: 'agentEvent', roomId, event });
  }

  emitRoomState(state: RoomState) {
    this.broadcast({ type: 'roomState', roomId: state.config.id, state });
  }

  emitRoomSummary(roomId: string, summary: import('./types').DiscussionSummary) {
    this.broadcast({ type: 'roomSummary', roomId, summary });
  }

  emitDirectMessage(characterId: string, message: ChatMessage) {
    this.broadcast({ type: 'directMessage', characterId, message });
  }

  emitDirectMessages(characterId: string, messages: ChatMessage[]) {
    this.broadcast({ type: 'directMessages', characterId, messages });
  }

  emitDirectEvent(characterId: string, event: AgentEvent) {
    this.broadcast({ type: 'directEvent', characterId, event });
  }

  emitDirectSummary(characterId: string, summary: import('./types').DiscussionSummary) {
    this.broadcast({ type: 'directSummary', characterId, summary });
  }

  emitDirectReset(characterId: string) {
    this.broadcast({ type: 'directReset', characterId });
  }
}
