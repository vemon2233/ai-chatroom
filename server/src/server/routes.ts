import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { ChatRoom, makeRoomConfig, type CreateRoomInput } from '../core/room';
import type { MessageBus } from '../core/bus';
import { deleteRoom, persistRoom } from '../store/rooms';
import { appendMessage, loadRoomMessages, rewriteRoomMessages } from '../store/transcript';
import { CharacterStore } from '../store/characters';
import { DirectChatService } from '../core/direct';
import { getAdapter as getAdapterByKind } from '../adapters/index';
import { Admin } from '../core/admin';
import { getTrace, listTraces, computeSessionStats, saveTrace } from '../store/trace';
import { listSummarySnapshots, getSummarySnapshot, getSummary, saveSummarySnapshot } from '../store/summary';
import { parseCharacterCard, detectImportType } from '../core/characterCard';
import { dedupeName } from '../core/room';
import {
  appendDirectMessage,
  loadDirectMessages,
  rewriteDirectMessages,
  resetDirectChat,
  deleteDirectChat,
  loadDirectMeta,
  saveDirectMeta,
} from '../store/directChats';
import type { Character, RoomSettings } from '../core/types';
import type { AdapterConfig, AppConfig } from './config';
import { settings } from '../store/settings';
import { t } from '../core/i18n/messages';

/** core 窄接口的 store 实现(server 层装配——core 不 import store,依赖单向) */
const summaryStore = { getSummary, saveSummarySnapshot };
const traceStore = { saveTrace };
const directChatStore = {
  appendDirectMessage,
  loadDirectMessages,
  rewriteDirectMessages,
  resetDirectChat,
  deleteDirectChat,
  loadDirectMeta,
  saveDirectMeta,
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

/** 读取原始请求二进制 Buffer (支持 JSON 文本与 PNG 二进制图片，上限 15MB) */
function readRawBody(req: IncomingMessage, maxBytes = 15 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error(t(settings.getLang(), 'api.uploadTooLarge')));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
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
        settings.getLang,
      )
    : undefined;

  const directChat = new DirectChatService({
    bus,
    adapterConfigs,
    resolveAdapter: (adapterKey: string) => {
      const entry = adapterConfigs[adapterKey];
      if (!entry) throw new Error(t(settings.getLang(), 'api.unknownAdapterCfg', { key: adapterKey }));
      return getAdapterByKind(entry.kind);
    },
    admin: adminInstance,
    store: directChatStore,
    summaryStore,
    traceStore,
    getLang: settings.getLang,
  });

  async function doImportCharacter(buf: Buffer): Promise<Character> {
    const detected = detectImportType(buf);
    if (detected.type === 'room') {
      throw new Error(t(settings.getLang(), 'api.roomFileNotCharacter'));
    }
    await characters.ensureLoaded();
    const parsed = parseCharacterCard(buf, {
      defaultAdapter: cfg.admin?.adapter || 'claude',
      availableAdapters: Object.keys(adapterConfigs),
    });
    const existingNames = characters.list().map((c) => c.name);
    const dedupedName = dedupeName(parsed.name, existingNames);
    const created = await characters.create({
      ...parsed,
      name: dedupedName,
    });
    bus.broadcast({ type: 'characters' });
    return created;
  }

  async function doImportRoom(buf: Buffer): Promise<{ id: string; state: any }> {
    const detected = detectImportType(buf);
    if (detected.type === 'character') {
      throw new Error(t(settings.getLang(), 'api.characterFileNotRoom'));
    }
    let rawData: any;
    try {
      rawData = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new Error(t(settings.getLang(), 'api.roomJsonInvalid'));
    }
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
      throw new Error(t(settings.getLang(), 'api.roomStructInvalid'));
    }

    const name = typeof rawData.name === 'string' && rawData.name.trim() ? rawData.name.trim() : t(settings.getLang(), 'api.unnamedRoom');
    const existingNames = Array.from(rooms.values()).map((r) => r.config.name);
    const dedupedName = dedupeName(name, existingNames);

    // 成员快照自愈与清洗 (剥离旧 sessionIds)
    const rawMembers = Array.isArray(rawData.members) ? rawData.members : [];
    const defaultAdapter = cfg.admin?.adapter || Object.keys(adapterConfigs)[0] || 'claude';
    const cleanedMembers = rawMembers.map((m: any, idx: number) => {
      const mAdapter = (typeof m.adapter === 'string' && adapterConfigs[m.adapter]) ? m.adapter : defaultAdapter;
      return {
        id: `m${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${idx}`,
        name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : t(settings.getLang(), 'api.memberN', { n: idx + 1 }),
        avatar: typeof m.avatar === 'string' ? m.avatar : '',
        adapter: mAdapter,
        model: typeof m.model === 'string' ? m.model : undefined,
        color: typeof m.color === 'string' ? m.color : undefined,
        persona: typeof m.persona === 'string' ? m.persona : '',
        thinking: typeof m.thinking === 'boolean' ? m.thinking : undefined,
        extraArgs: Array.isArray(m.extraArgs) ? m.extraArgs.map(String) : undefined,
      };
    });

    // 项目路径跨机检查：本地不存在则置空
    let projectPath: string | undefined = undefined;
    if (typeof rawData.projectPath === 'string' && existsSync(rawData.projectPath)) {
      projectPath = rawData.projectPath;
    }

    const userPersona = rawData.userPersona && typeof rawData.userPersona === 'object'
      ? {
          characterId: typeof rawData.userPersona.characterId === 'string' ? rawData.userPersona.characterId : undefined,
          name: typeof rawData.userPersona.name === 'string' ? rawData.userPersona.name : t(settings.getLang(), 'sys.user'),
          avatar: typeof rawData.userPersona.avatar === 'string' ? rawData.userPersona.avatar : undefined,
          color: typeof rawData.userPersona.color === 'string' ? rawData.userPersona.color : undefined,
          persona: typeof rawData.userPersona.persona === 'string' ? rawData.userPersona.persona : undefined,
        }
      : undefined;

    const rcfg = makeRoomConfig({
      name: dedupedName,
      topic: typeof rawData.topic === 'string' ? rawData.topic : undefined,
      color: typeof rawData.color === 'string' ? rawData.color : undefined,
      speechLength: rawData.speechLength,
      chainBudget: rawData.chainBudget,
      mode: rawData.mode === 'subscribe' ? 'subscribe' : 'baton',
      toolPermission: rawData.toolPermission,
      contextMode: rawData.contextMode === 'stateful' ? 'stateful' : 'stateless',
      projectPath,
      userPersona,
      members: cleanedMembers,
    }, settings.getLang());

    const newRoom = new ChatRoom(
      rcfg, bus, adapterConfigs, cfg.admin,
      {
        persistRoom,
        loadMessages: (roomId: string) => loadRoomMessages(roomId),
        rewriteMessages: (roomId: string, messages: import('../core/types').ChatMessage[]) =>
          rewriteRoomMessages(roomId, messages),
        appendMessage,
      },
      cfg.summary,
      { summaryStore, traceStore, getLang: settings.getLang },
    );

    rooms.set(newRoom.id, newRoom);
    await persistRoom(rcfg);
    bus.broadcast({ type: 'rooms' });
    return { id: newRoom.id, state: newRoom.getState() };
  }

  return {
    rooms,

    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;
      const method = req.method ?? 'GET';

      // ---- 全局设置(语言) ----
      if (p === '/api/settings' && method === 'GET') {
        return json(res, 200, { lang: settings.getLang() });
      }
      if (p === '/api/settings/language' && method === 'PUT') {
        const body = await readBody(req);
        if (body.lang !== 'zh' && body.lang !== 'en') {
          return json(res, 400, { error: t(settings.getLang(), 'api.badLang') });
        }
        await settings.setLang(body.lang);
        return json(res, 200, { lang: body.lang });
      }

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
          return json(res, 400, { error: t(settings.getLang(), 'api.charNeedNamePersona') });
        }
        if (!adapterConfigs[body.adapter]) {
          return json(res, 400, { error: t(settings.getLang(), 'api.unknownAdapter', { key: body.adapter }) });
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

      // ---- 通用智能导入网关 (自动嗅探角色卡与房间配置) ----
      if (p === '/api/import' && method === 'POST') {
        try {
          const buf = await readRawBody(req);
          if (!buf.length) return json(res, 400, { error: t(settings.getLang(), 'api.emptyUpload') });
          const detected = detectImportType(buf);
          if (detected.type === 'character') {
            const character = await doImportCharacter(buf);
            return json(res, 201, { type: 'character', character, id: character.id });
          } else if (detected.type === 'room') {
            const roomResult = await doImportRoom(buf);
            return json(res, 201, { type: 'room', id: roomResult.id, state: roomResult.state });
          } else {
            return json(res, 400, { error: detected.error || t(settings.getLang(), 'api.unrecognizedFile') });
          }
        } catch (err: any) {
          return json(res, 400, { error: err.message || t(settings.getLang(), 'api.importFailed') });
        }
      }

      // ---- 角色导入 (支持原生 JSON、SillyTavern V1/V2/V3 JSON 与 PNG 角色卡) ----
      if (p === '/api/characters/import' && method === 'POST') {
        try {
          const buf = await readRawBody(req);
          if (!buf.length) return json(res, 400, { error: t(settings.getLang(), 'api.emptyUpload') });
          const created = await doImportCharacter(buf);
          return json(res, 201, created);
        } catch (err: any) {
          return json(res, 400, { error: err.message || t(settings.getLang(), 'api.charCardParseFailed') });
        }
      }

      const charMatch = p.match(/^\/api\/characters\/([^/]+)(?:\/(.+))?$/);
      if (charMatch) {
        const id = decodeURIComponent(charMatch[1]!);
        const sub = charMatch[2];

        // 角色导出为原生标准 JSON
        if (sub === 'export' && method === 'GET') {
          await characters.ensureLoaded();
          const char = characters.get(id);
          if (!char) return json(res, 404, { error: t(settings.getLang(), 'api.charNotFound') });
          const clean = {
            schema: 'ai-chatroom.character.v1',
            name: char.name,
            avatar: char.avatar || '',
            adapter: char.adapter,
            model: char.model,
            color: char.color,
            persona: char.persona,
            thinking: char.thinking,
            extraArgs: char.extraArgs,
            note: char.note,
          };
          const filename = `${encodeURIComponent(char.name)}.json`;
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
          });
          res.end(JSON.stringify(clean, null, 2));
          return;
        }

        // 1v1 私聊历史
        if (sub === 'messages' && method === 'GET') {
          const msgs = await directChat.getMessages(id);
          return json(res, 200, msgs);
        }

        // 1v1 私聊配置与身份获取
        if (sub === 'direct-meta' && method === 'GET') {
          const meta = await directChat.getMeta(id);
          return json(res, 200, meta);
        }

        // 1v1 私聊配置与身份设置 (方案 A 守卫)
        if (sub === 'direct-meta' && (method === 'PUT' || method === 'POST')) {
          try {
            const body = await readBody(req);
            await directChat.setMeta(id, body);
            return json(res, 200, { ok: true, meta: await directChat.getMeta(id) });
          } catch (err: any) {
            return json(res, 400, { error: err.message || '设置私聊身份失败' });
          }
        }

        // 1v1 私聊用户发言
        if (sub === 'say' && method === 'POST') {
          await characters.ensureLoaded();
          const char = characters.get(id);
          if (!char) return json(res, 404, { error: t(settings.getLang(), 'api.charNotFound') });
          const { text } = await readBody(req);
          if (!text?.trim()) return json(res, 400, { error: t(settings.getLang(), 'api.emptyMessage') });
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
          if (!char) return json(res, 404, { error: t(settings.getLang(), 'api.charNotFound') });
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
                return json(res, 400, { error: t(settings.getLang(), 'api.editTextEmpty') });
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
          if (!trace) return json(res, 404, { error: t(settings.getLang(), 'api.traceNotFound') });
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
          if (!char) return json(res, 404, { error: t(settings.getLang(), 'api.charNotFound') });
          const sum = await directChat.refreshSummary(id, char);
          return json(res, 200, sum || { text: '', updatedAt: Date.now(), messageCount: 0 });
        }

        // 1v1 私聊历史摘要快照列表与详情
        if (sub === 'summaries' && method === 'GET') {
          const list = await listSummarySnapshots('direct', id);
          return json(res, 200, list);
        }
        const charSumMatch = sub?.match(/^summaries\/([^/]+)$/);
        if (charSumMatch && method === 'GET') {
          const sumId = decodeURIComponent(charSumMatch[1]!);
          const snap = await getSummarySnapshot('direct', id, sumId);
          if (!snap) return json(res, 404, { error: t(settings.getLang(), 'api.summaryNotFound') });
          return json(res, 200, snap);
        }

        // 1v1 私聊用量与开销度量统计
        if (sub === 'stats' && method === 'GET') {
          await characters.ensureLoaded();
          const char = characters.get(id);
          if (!char) return json(res, 404, { error: t(settings.getLang(), 'api.charNotFound') });
          const messages = await directChat.getMessages(id);
          const stats = await computeSessionStats('direct', id, [char], messages);
          return json(res, 200, stats);
        }

        if (!sub && (method === 'PUT' || method === 'PATCH')) {
          const body = await readBody(req);
          if (body.adapter && !adapterConfigs[body.adapter]) {
            return json(res, 400, { error: t(settings.getLang(), 'api.unknownAdapter', { key: body.adapter }) });
          }
          const updated = await characters.update(id, body);
          if (!updated) return json(res, 404, { error: t(settings.getLang(), 'api.charNotFound') });
          directChat.invalidateSession(id);
          bus.broadcast({ type: 'characters' });
          return json(res, 200, updated);
        }
        if (!sub && method === 'DELETE') {
          const ok = await characters.remove(id);
          if (!ok) return json(res, 404, { error: t(settings.getLang(), 'api.charNotFound') });
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
        if (!room) return json(res, 404, { error: t(settings.getLang(), 'api.roomNotFound', { id: roomId }) });
        const { characterIds } = await readBody(req);
        await characters.ensureLoaded();
        const inputs = ((characterIds as string[]) ?? [])
          .map((cid) => characters.get(cid))
          .filter((c): c is Character => !!c);
        if (inputs.length === 0) return json(res, 400, { error: t(settings.getLang(), 'api.noValidCharacters') });
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
            return json(res, 400, { error: t(settings.getLang(), 'api.unknownAdapter', { key: m.adapter }) });
          }
        }
        if (body.projectPath && !existsSync(body.projectPath)) {
          return json(res, 400, { error: t(settings.getLang(), 'api.projectDirMissing', { path: body.projectPath }) });
        }
        const rcfg = makeRoomConfig(body, settings.getLang());
        const room = new ChatRoom(
          rcfg, bus, adapterConfigs, cfg.admin,
          {
            persistRoom,
            loadMessages: (roomId: string) => loadRoomMessages(roomId),
            rewriteMessages: (roomId: string, messages: import('../core/types').ChatMessage[]) =>
              rewriteRoomMessages(roomId, messages),
            appendMessage,
          },
          cfg.summary,
          { summaryStore, traceStore, getLang: settings.getLang },
        );
        rooms.set(room.id, room);
        await persistRoom(rcfg);
        bus.broadcast({ type: 'rooms' });
        return json(res, 201, { id: room.id, state: room.getState() });
      }

      // ---- 房间导入 (自包含快照, 防腐自愈, 重名消歧) ----
      if (p === '/api/rooms/import' && method === 'POST') {
        try {
          const buf = await readRawBody(req);
          if (!buf.length) return json(res, 400, { error: t(settings.getLang(), 'api.emptyUpload') });
          const result = await doImportRoom(buf);
          return json(res, 201, result);
        } catch (err: any) {
          return json(res, 400, { error: err.message || '房间导入失败' });
        }
      }

      const roomMatch = p.match(/^\/api\/rooms\/([^/]+)(?:\/(.+))?$/);
      if (roomMatch) {
        const roomId = decodeURIComponent(roomMatch[1]!);
        const sub = roomMatch[2];
        const room = rooms.get(roomId);
        if (!room && sub !== 'messages') {
          return json(res, 404, { error: t(settings.getLang(), 'api.roomNotFound', { id: roomId }) });
        }

        // 房间配置导出 (含成员快照, 无历史消息, 清洗 sessionIds)
        if (sub === 'export' && method === 'GET') {
          const r = room!.config;
          const cleanMembers = r.members.map((m) => {
            const { sessionIds, ...rest } = m;
            return rest;
          });
          const exportData = {
            schema: 'ai-chatroom.room.v1',
            name: r.name,
            topic: r.topic,
            color: r.color,
            speechLength: r.speechLength,
            chainBudget: r.chainBudget,
            mode: r.mode,
            toolPermission: r.toolPermission,
            contextMode: r.contextMode,
            projectPath: r.projectPath,
            userPersona: r.userPersona,
            members: cleanMembers,
          };
          const filename = `${encodeURIComponent(r.name)}.json`;
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
          });
          res.end(JSON.stringify(exportData, null, 2));
          return;
        }

        // 房间详情
        if (!sub && method === 'GET') {
          return json(res, 200, room!.getState());
        }

        // 历史消息(房间运行态内存权威源——restore 时已 backfill;已删房间降级读磁盘 JSONL 供回看)
        if (sub === 'messages' && method === 'GET') {
          const msgs = room ? room.history : await loadRoomMessages(roomId);
          return json(res, 200, msgs);
        }

        // 用户发言(@语法路由在编排器内处理)
        if (sub === 'say' && method === 'POST') {
          const { text } = await readBody(req);
          if (!text?.trim()) return json(res, 400, { error: t(settings.getLang(), 'api.emptyMessage') });
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
                return json(res, 400, { error: t(settings.getLang(), 'api.editTextEmpty') });
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
          if (!trace) return json(res, 404, { error: t(settings.getLang(), 'api.traceNotFound') });
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

        // 房间历史摘要快照列表与详情
        if (sub === 'summaries' && method === 'GET') {
          const list = await listSummarySnapshots('room', roomId);
          return json(res, 200, list);
        }
        const roomSumMatch = sub?.match(/^summaries\/([^/]+)$/);
        if (roomSumMatch && method === 'GET') {
          const sumId = decodeURIComponent(roomSumMatch[1]!);
          const snap = await getSummarySnapshot('room', roomId, sumId);
          if (!snap) return json(res, 404, { error: t(settings.getLang(), 'api.summaryNotFound') });
          return json(res, 200, snap);
        }

        // 房间用量与开销度量统计
        if (sub === 'stats' && method === 'GET') {
          const stats = await computeSessionStats('room', roomId, room!.config.members, room!.history);
          return json(res, 200, stats);
        }

        // 给指定成员直接下指令
        if (sub === 'instruct' && method === 'POST') {
          const { memberId, text } = await readBody(req);
          if (!memberId || !text?.trim()) return json(res, 400, { error: t(settings.getLang(), 'api.needMemberAndText') });
          void room!.directInstruction(memberId, text.trim()).catch((e) => {
            console.error(`[instruct] room=${roomId}:`, e);
            void room!.systemNotice(t(settings.getLang(), 'api.instructionFailed', { msg: String(e) }));
          });
          return json(res, 202, { ok: true });
        }

        // 添加成员(批量)
        if (sub === 'members' && method === 'POST') {
          const body = await readBody(req);
          const inputs = Array.isArray(body) ? body : body.members;
          if (!Array.isArray(inputs) || inputs.length === 0) {
            return json(res, 400, { error: t(settings.getLang(), 'api.needMembersArray') });
          }
          for (const m of inputs) {
            if (!m.adapter || !adapterConfigs[m.adapter]) {
              return json(res, 400, { error: t(settings.getLang(), 'api.unknownAdapter', { key: m.adapter }) });
            }
            if (!m.name?.trim()) m.name = t(settings.getLang(), 'api.member');
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
            void room!.systemNotice(t(settings.getLang(), 'api.orchStartFailed', { msg: String(e) }));
          });
          return json(res, 202, { ok: true });
        }
        if (sub === 'stop' && method === 'POST') {
          await room!.stop();
          return json(res, 200, { ok: true });
        }

        // 运行期设置面板(即时生效)
        if (sub === 'settings' && (method === 'PATCH' || method === 'PUT')) {
          try {
            const body = await readBody(req) as Partial<RoomSettings>;
            await room!.updateSettings(body);
            return json(res, 200, room!.getState());
          } catch (err: any) {
            return json(res, 400, { error: err.message || t(settings.getLang(), 'api.updateSettingsFailed') });
          }
        }

        // 删除房间(config 移除,历史 JSONL 保留)
        if (!sub && method === 'DELETE') {
          // 先停止编排(杀进程/清心跳/收拢状态):否则运行中房间被删后,
          // 发言尾部 persistRoom 会把 config 写回 rooms.json → 房间"复活"成僵尸
          if (room) await room.stop();
          rooms.delete(roomId);
          await deleteRoom(roomId);
          bus.broadcast({ type: 'rooms' });
          return json(res, 200, { ok: true });
        }
      }

      json(res, 404, { error: t(settings.getLang(), 'api.noSuchRoute', { method, path: p }) });
    },
  };
}
