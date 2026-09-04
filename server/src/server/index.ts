// AI 聊天室 v2 — 服务入口。
// npm run dev → http://localhost:3220
// 启动顺序(关键):loadConfig → 复活房间(rooms.json → ChatRoom → await restore)
// → 全部恢复完才 listen(防启动窗口读到空历史)。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { REPO_ROOT } from '../paths';
import { MessageBus } from '../core/bus';
import { ChatRoom } from '../core/room';
import { loadAllRooms, persistRoom } from '../store/rooms';
import { loadRoomMessages, rewriteRoomMessages } from '../store/transcript';
import { createRoutes } from './routes';
import { setupWs } from './ws';

/** 持久化接缝(server 注入 store 实现给 core 的 ChatRoom——依赖单向:server→core,core 不知 store)。 */
const roomPersistence = {
  persistRoom,
  loadMessages: (roomId: string) => loadRoomMessages(roomId),
  rewriteMessages: (roomId: string, messages: import('../core/types').ChatMessage[]) =>
    rewriteRoomMessages(roomId, messages),
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function main() {
  const cfg = await loadConfig();
  const bus = new MessageBus();

  // ---- 房间复活(v2 新增):配置/历史/sessionIds 恢复;编排运行态归零(idle) ----
  const rooms = new Map<string, ChatRoom>();
  const persisted = await loadAllRooms();
  for (const rcfg of persisted) {
    // 适配器被删的角色:成员保留,首次发言时报错并提示(不阻塞复活)
    const room = new ChatRoom(rcfg, bus, cfg.adapters, cfg.scout, roomPersistence);
    await room.restore(); // JSONL 历史进内存(listen 前完成)
    rooms.set(room.id, room);
  }
  if (persisted.length > 0) {
    console.log(`  已复活 ${persisted.length} 个房间(编排状态归零,历史完整)`);
  }

  const routes = createRoutes(bus, cfg, rooms);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      try {
        await routes.handle(req, res);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // 静态文件:web/dist(生产);开发时由 vite(5173)服务,这里的兜底基本不触发
    const WEB_ROOT = path.resolve(REPO_ROOT, 'web', 'dist');
    const file = p === '/' ? '/index.html' : p;
    const safe = path.normalize(file).replace(/^([/\\])+/, '');
    const full = path.resolve(WEB_ROOT, safe);
    if (!full.startsWith(WEB_ROOT)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    try {
      const content = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end(existsSync(WEB_ROOT) ? 'Not Found' : '前端未构建(npm run build);开发模式请访问 vite 端口');
    }
  });

  setupWs(server, bus);

  const port = cfg.server.port ?? 3220;
  const host = cfg.server.host ?? '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`\n  AI 聊天室 v2 已启动 → http://${host}:${port}`);
    console.log(`  已注册适配器: ${Object.keys(cfg.adapters).join(', ')}\n`);
  });
}

main().catch((e) => {
  console.error('启动失败:', e);
  process.exit(1);
});