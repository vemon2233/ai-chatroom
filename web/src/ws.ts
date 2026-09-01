// WebSocket 客户端:自动重连;事件经 store 分发。

import type { WsEvent } from '@server/core/bus';

export function connectWs(onEvent: (ev: WsEvent) => void): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // vite dev 代理 /ws → 3210;同源直连(vite ws 代理配置)
  const ws = new WebSocket(`${proto}://${location.host}`);

  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data) as WsEvent);
    } catch (err) {
      console.error('[ws] 消息解析失败:', err);
    }
  };
  ws.onclose = () => setTimeout(() => connectWs(onEvent), 2000); // 断线重连
  ws.onerror = () => ws.close();
}
