// MessageBus:房间内消息路由 + WebSocket 广播 + JSONL 持久化。
// 服务器全局唯一;编排器经它收发,前端经 ws 收实时事件。

import type { WebSocket } from 'ws';
import type { AgentEvent } from '../adapters/base';
import type { ChatMessage, RoomState } from './types';
import { appendMessage } from '../store/transcript';

/** 推送给前端的事件包 */
export type WsEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'agentEvent'; roomId: string; event: AgentEvent }
  | { type: 'roomState'; roomId: string; state: RoomState }
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

  /** 适配器原始事件(思考中/增量流),只广播不持久化。 */
  emitAgentEvent(roomId: string, event: AgentEvent) {
    this.broadcast({ type: 'agentEvent', roomId, event });
  }

  emitRoomState(state: RoomState) {
    this.broadcast({ type: 'roomState', roomId: state.config.id, state });
  }
}
