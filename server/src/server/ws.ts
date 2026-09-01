// WebSocket 升级与连接管理。

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { MessageBus } from '../core/bus';

export function setupWs(server: HttpServer, bus: MessageBus) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    bus.addClient(ws);
    ws.send(JSON.stringify({ type: 'hello', payload: 'AI 聊天室已连接' }));
  });

  return wss;
}
