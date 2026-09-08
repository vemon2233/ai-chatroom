// WebSocket 升级与连接管理。

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { MessageBus } from '../core/bus';
import { settings } from '../store/settings';
import { t } from '../core/i18n/messages';

export function setupWs(server: HttpServer, bus: MessageBus) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    bus.addClient(ws);
    ws.send(JSON.stringify({ type: 'hello', payload: t(settings.getLang(), 'ws.hello') }));
  });

  return wss;
}
