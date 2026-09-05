import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { ChatRoom, makeRoomConfig, type CreateRoomInput } from '../core/room';
import type { MessageBus } from '../core/bus';
import { deleteRoom, persistRoom } from '../store/rooms';
import { loadRoomMessages, rewriteRoomMessages } from '../store/transcript';
import { CharacterStore } from '../store/characters';
import { DirectChatService } from '../core/direct';
import { getAdapter as getAdapterByKind } from '../adapters/index';
import { Admin } from '../core/admin';
import { getTrace, listTraces } from '../store/trace';
import type { Character, RoomSettings } from '../core/types';
import type { AdapterConfig, AppConfig } from './config';

/** 组装 ChatRoom 的持久化接缝(server 层负责把 store 实现注入 core——依赖单向)。 */
const roomPersistence = {
  persistRoom,
  loadMessages: (roomId: string) => loadRoomMessages(roomId),
  rewriteMessages: (roomId: string, messages: import('../core/types').ChatMessage[]) =>
    rewriteRoomMessages(roomId, messages),
};

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createRoutes(bus: MessageBus, cfg: AppConfig, rooms: Map<string, ChatRoom>) {
  const adapterConfigs = cfg.adapters;
  const characters = new CharacterStore();

  const adminAdapterEntry = adapterConfigs[cfg.admin.adapter];
  const adminInstance = adminAdapterEntry
    ? new Admin(
        cfg.admin,
        (key) => {
          const entry = adapterConfigs[key];
          if (!entry) throw new Error(`管理员/侦察适配器未配置: ${key}`);
          return getAdapterByKind(entry.kind);
        },
        { command: adminAdapterEntry.command, args: adminAdapterEntry.args },
      )
    : undefined;

  const directChat = new DirectChatService({
    bus,
    adapterConfigs,
    resolveAdapter: (adapterKey: string) => {
      const entry = adapterConfigs[adapterKey];
      if (!entry) throw new Error(`未知适配器配置: ${adapterKey}`);
      return getAdapterByKind(entry.kind);
    },
    admin: adminInstance,
  });

  return {
    rooms,

    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;
      const method = req.method ?? 'GET';

      // ---- 适配器列表(前端建房间下拉用)----
      if (p === '/api/adapters' && method === 'GET') {
        const adapters = Object.entries(adapterConfigs).map(([key, a]) => ({
          key,
          displayName: a.displayName,
          kind: a.kind,
        }));
        return json(res, 200, { adapters });
      }

      // ---- 角色库 CRUD & 专属 1v1 私聊 ----
      if (p === '/api/characters' && method === 'GET') {
        await characters.ensureLoaded();
        return json(res, 200, characters.list());
      }
      if (p === '/api/characters' && method === 'POST') {
        const body = await readBody(req);
        if (!body.name?.trim() || !body.persona?.trim()) {
          return json(res, 400, { error: '角色需要名字和人设' });
        }
        if (!adapterConfigs[body.adapter]) {
          return json(res, 400, { error: `未知适配器: ${body.adapter}` });
        }
        const c = await characters.create({
          name: body.name.trim(),
          color: body.color,
          adapter: body.adapter,
          persona: body.persona.trim(),
          extraArgs: body.extraArgs,
          note: body.note,
        });
        bus.broadcast({ type: 'characters' });
        return json(res, 201, c);
      }
      const charMatch = p.match(/^\/api\/characters\/([^/]+)(?:\/(.+))?$/);
      if (charMatch) {
        const id = decodeURIComponent(charMatch[1]!);
        const sub = charMatch[2];

        // 1v1 私聊历史
        if (sub === 'messages' && method === 'GET') {
          const msgs = await directChat.getMessages(id);
          return json(res, 200, msgs);
        }

        // 1v1 私聊用户发言
        if (sub === 'say' && method === 'POST') {
          await characters.ensureLoaded();
          const char = characters.get(id);
          if (!char) return json(res, 404, { error: '角色不存在' });
          const { text } = await readBody(req);
          if (!text?.trim()) return json(res, 400, { error: '空消息' });
          await directChat.userSpeak(char, text.trim());
          return json(res, 200, { ok: true });
        }

        // 1v1 私聊停止输出
        if (sub === 'stop' && method === 'POST') {
          await directChat.stop(id);
          return json(res, 200, { ok: true });
        }

        // 1v1 私聊清空重置
        if (sub === 'reset' && method === 'POST') {
          await directChat.reset(id);
          return json(res, 200, { ok: true });
        }

        // 1v1 私聊消息重roll / 截断 / 回溯编辑
        const charMsgActionMatch = sub?.match(/^messages\/([^/]+)\/(reroll|truncate|edit)$/);
        if (charMsgActionMatch && method === 'POST') {
          await characters.ensureLoaded();
          const char = characters.get(id);
          if (!char) return json(res, 404, { error: '角色不存在' });
          const msgId = decodeURIComponent(charMsgActionMatch[1]!);
          const action = charMsgActionMatch[2];
          try {
            if (action === 'reroll') {
              await directChat.reroll(char, msgId);
              return json(res, 200, { ok: true });
            }
            if (action === 'truncate') {
              const remaining = await directChat.truncateAfter(id, msgId);
              return json(res, 200, { ok: true, messages: remaining });
            }
            if (action === 'edit') {
              const body = await readBody(req);
              if (typeof body.text !== 'string' || !body.text.trim()) {
                return json(res, 400, { error: '编辑文本不能为空' });
              }
              await directChat.saveEdit(char, msgId, body.text.trim());
              return json(res, 200, { ok: true });
            }
          } catch (e: any) {
            return json(res, 400, { error: e.message || String(e) });
          }
        }

        // 1v1 私聊 Trace 列表与详情
        if (sub === 'traces' && method === 'GET') {
          const list = await listTraces('direct', id);
          return json(res, 200, list);
        }
        const charTraceMatch = sub?.match(/^traces\/([^/]+)$/);
        if (charTraceMatch && method === 'GET') {
          const msgId = decodeURIComponent(charTraceMatch[1]!);
          const trace = await getTrace('direct', id, msgId);
          if (!trace) return json(res, 404, { error: '未找到调用日志' });
          return json(res, 200, trace);
        }

        // 1v1 私聊讨论摘要获取与刷新
        if (sub === 'summary' && method === 'GET') {
          const sum = await directChat.getSummary(id);
          return json(res, 200, sum || { text: '', updatedAt: 0, messageCount: 0 });
        }
        if (sub === 'summary/refresh' && method === 'POST') {
          await characters.ensureLoaded();
          const char = characters.get(id);
          if (!char) return json(res, 404, { error: '角色不存在' });
          const sum = await directChat.refreshSummary(id, char);
          return json(res, 200, sum || { text: '', updatedAt: Date.now(), messageCount: 0 });
        }

        if (!sub && (method === 'PUT' || method === 'PATCH')) {
          const body = await readBody(req);
          if (body.adapter && !adapterConfigs[body.adapter]) {
            return json(res, 400, { error: `未知适配器: ${body.adapter}` });
          }
          const updated = await characters.update(id, body);
          if (!updated) return json(res, 404, { error: '角色不存在' });
          directChat.invalidateSession(id);
          bus.broadcast({ type: 'characters' });
          return json(res, 200, updated);
        }
        if (!sub && method === 'DELETE') {
          const ok = await characters.remove(id);
          if (!ok) return json(res, 404, { error: '角色不存在' });
          await directChat.delete(id);
          bus.broadcast({ type: 'characters' });
          return json(res, 200, { ok: true });
        }
      }

      // ---- 拉角色进房间(复制快照)----
      const pullMatch = p.match(/^\/api\/rooms\/([^/]+)\/pull-character$/);
      if (pullMatch && method === 'POST') {
        const roomId = decodeURIComponent(pullMatch[1]!);
        const room = rooms.get(roomId);
        if (!room) return json(res, 404, { error: `房间不存在: ${roomId}` });
        const { characterIds } = await readBody(req);
        await characters.ensureLoaded();
        const inputs = ((characterIds as string[]) ?? [])
          .map((cid) => characters.get(cid))
          .filter((c): c is Character => !!c);
        if (inputs.length === 0) return json(res, 400, { error: '没有有效角色' });
        const added = await room.addMembers(
          inputs.map((c) => ({
            name: c.name,
            color: c.color,
            adapter: c.adapter,
            persona: c.persona,
            extraArgs: c.extraArgs,
            characterId: c.id,
          })),
        );
        return json(res, 201, { added, state: room.getState() });
      }

      // ---- 房间列表(含最近一条消息预览;含重启复活房间)----
      if (p === '/api/rooms' && method === 'GET') {
        const list = [];
        for (const room of rooms.values()) {
          const last = room.history[room.history.length - 1];
          list.push({
            ...room.getState(),
            lastMessage: last ? { fromName: last.fromName, text: last.text.slice(0, 60), ts: last.ts } : null,
            messageCount: room.history.length,
          });
        }
        return json(res, 200, list);
      }

      // ---- 创建房间(成员可为空,进房后再添加)----
      if (p === '/api/rooms' && method === 'POST') {
        const body = (await readBody(req)) as CreateRoomInput;
        for (const m of body.members ?? []) {
          if (!adapterConfigs[m.adapter]) {
            return json(res, 400, { error: `未知适配器: ${m.adapter}` });
          }
        }
        if (body.projectPath && !existsSync(body.projectPath)) {
          return json(res, 400, { error: `项目目录不存在: ${body.projectPath}` });
        }
        const rcfg = makeRoomConfig(body);
        const room = new ChatRoom(rcfg, bus, adapterConfigs, cfg.scout, roomPersistence);
        rooms.set(room.id, room);
        await persistRoom(rcfg);
        bus.broadcast({ type: 'rooms' });
        return json(res, 201, { id: room.id, state: room.getState() });
      }

      const roomMatch = p.match(/^\/api\/rooms\/([^/]+)(?:\/(.+))?$/);
      if (roomMatch) {
        const roomId = decodeURIComponent(roomMatch[1]!);
        const sub = roomMatch[2];
        const room = rooms.get(roomId);
        if (!room && sub !== 'messages') {
          return json(res, 404, { error: `房间不存在: ${roomId}` });
        }

        // 房间详情
        if (!sub && method === 'GET') {
          return json(res, 200, room!.getState());
        }

        // 历史消息(持久化读取,支持重启后回看)
        if (sub === 'messages' && method === 'GET') {
          const msgs = await loadRoomMessages(roomId);
          return json(res, 200, msgs);
        }

        // 用户发言(@语法路由在编排器内处理)
        if (sub === 'say' && method === 'POST') {
          const { text } = await readBody(req);
          if (!text?.trim()) return json(res, 400, { error: '空消息' });
          await room!.userSpeak(text.trim());
          return json(res, 200, { ok: true });
        }

        // 清空房间消息
        if (sub === 'clear' && method === 'POST') {
          await room!.clearMessages();
          return json(res, 200, { ok: true });
        }

        // 消息重roll / 截断 / 回溯编辑
        const msgActionMatch = sub?.match(/^messages\/([^/]+)\/(reroll|truncate|edit)$/);
        if (msgActionMatch && method === 'POST') {
          const msgId = decodeURIComponent(msgActionMatch[1]!);
          const action = msgActionMatch[2];
          try {
            if (action === 'reroll') {
              await room!.reroll(msgId);
              return json(res, 200, { ok: true, state: room!.getState() });
            }
            if (action === 'truncate') {
              await room!.truncateAfter(msgId);
              return json(res, 200, { ok: true, state: room!.getState() });
            }
            if (action === 'edit') {
              const body = await readBody(req);
              if (typeof body.text !== 'string' || !body.text.trim()) {
                return json(res, 400, { error: '编辑文本不能为空' });
              }
              await room!.saveEdit(msgId, body.text.trim());
              return json(res, 200, { ok: true, state: room!.getState() });
            }
          } catch (e: any) {
            return json(res, 400, { error: e.message || String(e) });
          }
        }

        // 房间 Trace 列表与详情
        if (sub === 'traces' && method === 'GET') {
          const list = await listTraces('room', roomId);
          return json(res, 200, list);
        }
        const roomTraceMatch = sub?.match(/^traces\/([^/]+)$/);
        if (roomTraceMatch && method === 'GET') {
          const msgId = decodeURIComponent(roomTraceMatch[1]!);
          const trace = await getTrace('room', roomId, msgId);
          if (!trace) return json(res, 404, { error: '未找到调用日志' });
          return json(res, 200, trace);
        }

        // 房间讨论摘要获取与刷新
        if (sub === 'summary' && method === 'GET') {
          const sum = await room!.getSummary();
          return json(res, 200, sum || { text: '', updatedAt: 0, messageCount: 0 });
        }
        if (sub === 'summary/refresh' && method === 'POST') {
          const sum = await room!.refreshSummary();
          return json(res, 200, sum || { text: '', updatedAt: Date.now(), messageCount: 0 });
        }

        // 给指定成员直接下指令
        if (sub === 'instruct' && method === 'POST') {
          const { memberId, text } = await readBody(req);
          if (!memberId || !text?.trim()) return json(res, 400, { error: '缺 memberId 或 text' });
          void room!.directInstruction(memberId, text.trim()).catch((e) => {
            console.error(`[instruct] room=${roomId}:`, e);
            void room!.systemNotice(`指令执行失败: ${String(e)}`);
          });
          return json(res, 202, { ok: true });
        }

        // 添加成员(批量)
        if (sub === 'members' && method === 'POST') {
          const body = await readBody(req);
          const inputs = Array.isArray(body) ? body : body.members;
          if (!Array.isArray(inputs) || inputs.length === 0) {
            return json(res, 400, { error: '缺 members 数组' });
          }
          for (const m of inputs) {
            if (!m.adapter || !adapterConfigs[m.adapter]) {
              return json(res, 400, { error: `未知适配器: ${m.adapter}` });
            }
            if (!m.name?.trim()) m.name = '成员';
          }
          const added = await room!.addMembers(inputs);
          return json(res, 201, { added, state: room!.getState() });
        }

        // 移除成员
        if (sub && sub.startsWith('members/') && method === 'DELETE') {
          const memberId = decodeURIComponent(sub.slice('members/'.length));
          try {
            await room!.removeMember(memberId);
          } catch (e) {
            return json(res, 404, { error: String(e) });
          }
          return json(res, 200, { ok: true });
        }

        // 编排控制
        if (sub === 'start' && method === 'POST') {
          void room!.start().catch((e) => {
            console.error(`[start] room=${roomId}:`, e);
            void room!.systemNotice(`编排启动失败: ${String(e)}`);
          });
          return json(res, 202, { ok: true });
        }
        if (sub === 'stop' && method === 'POST') {
          await room!.stop();
          return json(res, 200, { ok: true });
        }

        // 运行期设置面板(即时生效)
        if (sub === 'settings' && (method === 'PATCH' || method === 'PUT')) {
          const body = await readBody(req) as Partial<RoomSettings>;
          await room!.updateSettings(body);
          return json(res, 200, room!.getState());
        }

        // 删除房间(config 移除,历史 JSONL 保留)
        if (!sub && method === 'DELETE') {
          rooms.delete(roomId);
          await deleteRoom(roomId);
          bus.broadcast({ type: 'rooms' });
          return json(res, 200, { ok: true });
        }
      }

      json(res, 404, { error: `无此路由: ${method} ${p}` });
    },
  };
}
