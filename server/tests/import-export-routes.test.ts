import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createRoutes } from '../src/server/routes';
import { MessageBus } from '../src/core/bus';
import { ChatRoom, makeRoomConfig } from '../src/core/room';
import type { AppConfig } from '../src/server/config';

function mockReq(method: string, url: string, body?: Buffer | string): any {
  const stream = new Readable() as any;
  stream._read = () => {};
  stream.method = method;
  stream.url = url;
  stream.headers = {};
  if (body) {
    stream.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
  }
  stream.push(null);
  return stream;
}

function mockRes(): { res: any; getStatusCode: () => number; getHeaders: () => Record<string, any>; getBody: () => string; getJson: () => any } {
  let statusCode = 200;
  const headers: Record<string, any> = {};
  let body = '';

  const res = new EventEmitter() as any;
  res.writeHead = (code: number, h?: Record<string, any>) => {
    statusCode = code;
    if (h) {
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = v;
      }
    }
  };
  res.setHeader = (k: string, v: any) => {
    headers[k.toLowerCase()] = v;
  };
  res.end = (chunk?: any) => {
    if (chunk) body += chunk.toString();
    res.emit('finish');
  };

  return {
    res,
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => body,
    getJson: () => {
      try {
        return body ? JSON.parse(body) : null;
      } catch {
        return body;
      }
    },
  };
}

const mockConfig: AppConfig = {
  admin: {
    adapter: 'claude',
    model: 'haiku',
    timeoutSec: 30,
    circuitBreakerConsecutiveErrors: 2,
    circuitBreakerCooldownSec: 10,
  },
  adapters: {
    claude: {
      displayName: 'Claude',
      kind: 'claude',
      command: 'node',
      args: [],
    },
  },
  summary: {
    model: 'haiku',
    autoThreshold: 30,
    privateThreshold: 20,
    compactThreshold: 40,
  },
};

describe('Import & Export REST Routes', () => {
  let bus: MessageBus;
  let rooms: Map<string, ChatRoom>;
  let routes: ReturnType<typeof createRoutes>;
  const createdCharIds: string[] = [];

  beforeEach(() => {
    bus = new MessageBus();
    rooms = new Map();
    routes = createRoutes(bus, mockConfig, rooms);
  });

  afterEach(async () => {
    const { CharacterStore } = await import('../src/store/characters');
    const store = new CharacterStore();
    for (const id of createdCharIds) {
      await store.remove(id).catch(() => {});
    }
    createdCharIds.length = 0;
  });

  it('POST /api/characters/import 能够成功导入原生 Character JSON 并支持重名消歧', async () => {
    const baseName = `架构师_${Math.random().toString(36).slice(2, 7)}`;
    const charPayload = JSON.stringify({
      name: baseName,
      adapter: 'claude',
      persona: '精通架构设计。',
      color: '#4fc1ff',
    });

    // 第一次导入
    const req1 = mockReq('POST', '/api/characters/import', charPayload);
    const res1 = mockRes();
    await routes.handle(req1, res1.res);

    expect(res1.getStatusCode()).toBe(201);
    const created1 = res1.getJson();
    if (created1?.id) createdCharIds.push(created1.id);
    expect(created1.name).toBe(baseName);
    expect(created1.persona).toBe('精通架构设计。');

    // 第二次导入相同内容 -> 触发 dedupeName
    const req2 = mockReq('POST', '/api/characters/import', charPayload);
    const res2 = mockRes();
    await routes.handle(req2, res2.res);

    expect(res2.getStatusCode()).toBe(201);
    const created2 = res2.getJson();
    if (created2?.id) createdCharIds.push(created2.id);
    expect(created2.name).toBe(`${baseName}2`);
  });

  it('GET /api/characters/:id/export 能够正确导出标准 JSON 并附带 Header', async () => {
    // 先创建一个角色
    const createReq = mockReq('POST', '/api/characters', JSON.stringify({
      name: '测试导出角色',
      adapter: 'claude',
      persona: '人设内容...',
    }));
    const createRes = mockRes();
    await routes.handle(createReq, createRes.res);
    const created = createRes.getJson();
    if (created?.id) createdCharIds.push(created.id);

    // 导出
    const exportReq = mockReq('GET', `/api/characters/${created.id}/export`);
    const exportRes = mockRes();
    await routes.handle(exportReq, exportRes.res);

    expect(exportRes.getStatusCode()).toBe(200);
    expect(exportRes.getHeaders()['content-type']).toContain('application/json');
    expect(exportRes.getHeaders()['content-disposition']).toContain('attachment');
    const exportedJson = exportRes.getJson();
    expect(exportedJson.schema).toBe('ai-chatroom.character.v1');
    expect(exportedJson.name).toBe('测试导出角色');
    expect(exportedJson.persona).toBe('人设内容...');
    expect(exportedJson.adapter).toBe('claude');
  });

  it('房间导入导出往返: 导出剥离旧 sessionIds，导入重新分配独立新 ID 与消歧', async () => {
    // 准备一个已有房间
    const rcfg = makeRoomConfig({
      name: '原开发组',
      topic: '架构设计讨论',
      chainBudget: 5,
      speechLength: 'medium',
      members: [
        {
          name: '爱丽丝',
          adapter: 'claude',
          persona: '前端专家',
          color: '#ff7b72',
        },
      ],
    });
    // 模拟运行态该成员拥有 sessionIds
    rcfg.members[0]!.sessionIds = { claude: 'sess-old-123' };

    const chatRoom = new ChatRoom(
      rcfg,
      bus,
      mockConfig.adapters,
      mockConfig.admin,
      {
        persistRoom: async () => {},
        loadMessages: async () => [],
        rewriteMessages: async () => {},
        appendMessage: async () => {},
      },
    );
    rooms.set(rcfg.id, chatRoom);

    // 1. 导出房间
    const exportReq = mockReq('GET', `/api/rooms/${rcfg.id}/export`);
    const exportRes = mockRes();
    await routes.handle(exportReq, exportRes.res);

    expect(exportRes.getStatusCode()).toBe(200);
    const exportedData = exportRes.getJson();
    expect(exportedData.schema).toBe('ai-chatroom.room.v1');
    expect(exportedData.name).toBe('原开发组');
    expect(exportedData.members).toHaveLength(1);
    // 关键防腐断言: 导出的快照必须剥离 sessionIds
    expect(exportedData.members[0].sessionIds).toBeUndefined();

    // 2. 导入该房间配置
    const importReq = mockReq('POST', '/api/rooms/import', JSON.stringify(exportedData));
    const importRes = mockRes();
    await routes.handle(importReq, importRes.res);

    expect(importRes.getStatusCode()).toBe(201);
    const importedResult = importRes.getJson();
    expect(importedResult.id).toBeDefined();
    expect(importedResult.id).not.toBe(rcfg.id); // 新分配 ID
    // 房间名消歧断言: 原有名为「原开发组」，导入的自动变为「原开发组2」
    expect(importedResult.state.config.name).toBe('原开发组2');
    expect(importedResult.state.config.members).toHaveLength(1);
    expect(importedResult.state.config.members[0].id).not.toBe(rcfg.members[0]!.id);
    expect(importedResult.state.config.members[0].name).toBe('爱丽丝');
  });

  it('POST /api/import 通用网关能够智能识别角色卡并分流', async () => {
    const charPayload = JSON.stringify({
      schema: 'ai-chatroom.character.v1',
      name: `通用智能角色_${Math.random().toString(36).slice(2, 6)}`,
      adapter: 'claude',
      persona: '通用设定',
    });

    const req = mockReq('POST', '/api/import', charPayload);
    const res = mockRes();
    await routes.handle(req, res.res);

    expect(res.getStatusCode()).toBe(201);
    const result = res.getJson();
    expect(result.type).toBe('character');
    expect(result.character).toBeDefined();
    if (result.id) createdCharIds.push(result.id);
  });

  it('POST /api/import 通用网关能够智能识别房间配置并分流', async () => {
    const roomPayload = JSON.stringify({
      schema: 'ai-chatroom.room.v1',
      name: '通用智能房间',
      members: [{ name: '小张', persona: '开发' }],
    });

    const req = mockReq('POST', '/api/import', roomPayload);
    const res = mockRes();
    await routes.handle(req, res.res);

    expect(res.getStatusCode()).toBe(201);
    const result = res.getJson();
    expect(result.type).toBe('room');
    expect(result.id).toBeDefined();
    expect(result.state).toBeDefined();
    expect(result.state.config.name).toBe('通用智能房间');
  });

  it('交叉导入防护: 角色接口拒绝房间配置，房间接口拒绝角色卡', async () => {
    const charPayload = JSON.stringify({
      schema: 'ai-chatroom.character.v1',
      name: '防误导入角色',
      persona: '角色人设',
    });
    const roomPayload = JSON.stringify({
      schema: 'ai-chatroom.room.v1',
      name: '防误导入房间',
      members: [],
    });

    // 1. 尝试将房间配置上传到角色导入接口
    const crossReq1 = mockReq('POST', '/api/characters/import', roomPayload);
    const crossRes1 = mockRes();
    await routes.handle(crossReq1, crossRes1.res);
    expect(crossRes1.getStatusCode()).toBe(400);
    expect(crossRes1.getJson().error).toContain('房间');

    // 2. 尝试将角色卡上传到房间导入接口
    const crossReq2 = mockReq('POST', '/api/rooms/import', charPayload);
    const crossRes2 = mockRes();
    await routes.handle(crossReq2, crossRes2.res);
    expect(crossRes2.getStatusCode()).toBe(400);
    expect(crossRes2.getJson().error).toContain('角色');
  });
});
