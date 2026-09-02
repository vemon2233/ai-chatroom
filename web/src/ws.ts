// WebSocket 客户端:自动重连;事件经 store 分发。

import type { WsEvent } from '@server/core/bus';

export function connectWs(onEvent: (ev: WsEvent) => void): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // 显式 /ws 路径:
  //  - dev:vite proxy 的 '/ws' 规则按路径前缀匹配,根路径连不中代理 → 实时推送全断
  //  - prod:后端 WebSocketServer 挂在 http server 上不校验路径,/ws 同样放行
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

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
