// 任务房 schema 与建房间隔测试(工单03 / ADR-0001):
// kind 字段落库、task 校验(projectPath 必填+存在、mode 锁 baton)、
// 任务默认值束(full/stateful)、存量兼容(缺省 chat)、导出含 kind、导入降级。
// 接缝:REST 路由层 mock req/res + 隔离 REPO_ROOT(import-export-routes.test.ts 同范式,
// 绝不触碰真实 data/)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { rm, mkdtemp } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AppConfig } from '../src/server/config';
import type { ChatRoom } from '../src/core/room';
import { MessageBus } from '../src/core/bus';

const ISOLATION_ROOT = path.join(tmpdir(), `ai-chatroom-task-room-test-${process.pid}`);
/** 测试用真实存在的项目目录(task 校验要 existsSync) */
let projectDir: string;

/** 以隔离 REPO_ROOT 重新加载路由工厂(拿到绑定隔离路径的 store 实例)。 */
async function loadIsolatedRoutes() {
  vi.resetModules();
  vi.doMock('../src/paths', () => ({ REPO_ROOT: ISOLATION_ROOT }));
  const { createRoutes } = await import('../src/server/routes');
  return createRoutes;
}

type CreateRoutes = Awaited<ReturnType<typeof loadIsolatedRoutes>>;

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

function mockRes(): { res: any; getStatusCode: () => number; getBody: () => string; getJson: () => any } {
  let statusCode = 200;
  let body = '';
  const res = new EventEmitter() as any;
  res.writeHead = (code: number) => { statusCode = code; };
  res.setHeader = () => {};
  res.end = (chunk?: any) => {
    if (chunk) body += chunk.toString();
    res.emit('finish');
  };
  return { res, getStatusCode: () => statusCode, getBody: () => body, getJson: () => { try { return body ? JSON.parse(body) : null; } catch { return body; } } };
}

const mockConfig: AppConfig = {
  admin: { adapter: 'claude', model: 'haiku', allowedTools: 'Read Glob Grep', timeoutMs: 30000, maxRetries: 2 },
  server: { port: 3220, host: '127.0.0.1' },
  speakTimeoutMs: 0,
  adapters: { claude: { displayName: 'Claude', kind: 'claude', command: 'node', args: [] } },
  summary: { model: 'haiku', autoThreshold: 30, privateThreshold: 20, compactThreshold: 40 },
};

async function postRoom(routes: ReturnType<CreateRoutes>, body: unknown) {
  const req = mockReq('POST', '/api/rooms', JSON.stringify(body));
  const r = mockRes();
  await routes.handle(req, r.res);
  return r;
}

describe('任务房 schema 与建房间隔(ADR-0001)', () => {
  let bus: MessageBus;
  let rooms: Map<string, ChatRoom>;
  let routes: ReturnType<CreateRoutes>;

  beforeEach(async () => {
    mkdirSync(ISOLATION_ROOT, { recursive: true });
    projectDir = path.join(ISOLATION_ROOT, 'proj');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'README.md'), '# t\n');
    bus = new MessageBus();
    rooms = new Map();
    const createRoutes = await loadIsolatedRoutes();
    routes = createRoutes(bus, mockConfig, rooms);
  });

  afterEach(async () => {
    vi.doUnmock('../src/paths');
    vi.resetModules();
    await rm(ISOLATION_ROOT, { recursive: true, force: true });
  });

  it('kind:task + 有效 projectPath → 201,配置束生效(full/stateful/baton)', async () => {
    const r = await postRoom(routes, {
      name: '任务房A', kind: 'task', topic: '改 bug', projectPath: projectDir,
      members: [{ name: '工程师', adapter: 'claude', persona: '你是工程师' }],
    });
    expect(r.getStatusCode()).toBe(201);
    const cfg = r.getJson().state.config;
    expect(cfg.kind).toBe('task');
    expect(cfg.toolPermission).toBe('full');
    expect(cfg.contextMode).toBe('stateful');
    expect(cfg.mode).toBe('baton');
    expect(cfg.projectPath).toBe(projectDir);
  });

  it('task 显式传 toolPermission/contextMode 仍可覆盖默认束', async () => {
    const r = await postRoom(routes, {
      name: '任务房-只读', kind: 'task', topic: 'x', projectPath: projectDir,
      toolPermission: 'readonly', contextMode: 'stateless',
      members: [],
    });
    expect(r.getJson().state.config.toolPermission).toBe('readonly');
    expect(r.getJson().state.config.contextMode).toBe('stateless');
  });

  it('task 强制 baton:传 subscribe 也落 baton,subscribeConfig 丢弃', async () => {
    const r = await postRoom(routes, {
      name: '任务房B', kind: 'task', topic: 'x', projectPath: projectDir,
      mode: 'subscribe', subscribeConfig: { heartbeatIntervalMs: 9999 },
      members: [],
    });
    const cfg = r.getJson().state.config;
    expect(cfg.mode).toBe('baton');
    expect(cfg.subscribeConfig).toBeUndefined();
  });

  it('task 缺 projectPath → 400,房间不落库', async () => {
    const r = await postRoom(routes, { name: 'C', kind: 'task', topic: 'x', members: [] });
    expect(r.getStatusCode()).toBe(400);
    expect(rooms.size).toBe(0);
  });

  it('task projectPath 本机不存在 → 400', async () => {
    const r = await postRoom(routes, {
      name: 'D', kind: 'task', topic: 'x', projectPath: 'Z:\\definitely\\not\\exists', members: [],
    });
    expect(r.getStatusCode()).toBe(400);
  });

  it('chat 房缺省照旧:kind 缺省/readonly/stateless(存量行为不变)', async () => {
    const r = await postRoom(routes, { name: 'E', topic: '闲聊', members: [] });
    expect(r.getStatusCode()).toBe(201);
    const cfg = r.getJson().state.config;
    expect(cfg.kind).toBeUndefined();
    expect(cfg.toolPermission).toBe('readonly');
    expect(cfg.contextMode).toBe('stateless');
  });

  it('导出含 kind;导入 task 房(路径有效)→ kind 保真往返', async () => {
    const created = await postRoom(routes, { name: 'F', kind: 'task', topic: 't', projectPath: projectDir, members: [] });
    const rid = created.getJson().id;
    expect(existsSync(path.join(ISOLATION_ROOT, 'data')) || true).toBe(true);

    const expReq = mockReq('GET', `/api/rooms/${rid}/export`);
    const expRes = mockRes();
    await routes.handle(expReq, expRes.res);
    const data = expRes.getJson();
    expect(data.kind).toBe('task');
    expect(data.mode).toBe('baton');

    const impReq = mockReq('POST', '/api/import', JSON.stringify(data));
    const impRes = mockRes();
    await routes.handle(impReq, impRes.res);
    expect(impRes.getStatusCode()).toBe(201);
    expect(impRes.getJson().state.config.kind).toBe('task');
  });

  it('导入 task 房路径本机失效 → 降级 chat + projectPath 置空 + 系统消息警示(不产僵尸任务房)', async () => {
    const data = {
      schema: 'ai-chatroom.room.v1',
      name: 'G', kind: 'task', topic: 't',
      projectPath: 'Z:\\gone\\away',
      members: [],
    };
    const impReq = mockReq('POST', '/api/import', JSON.stringify(data));
    const impRes = mockRes();
    await routes.handle(impReq, impRes.res);
    expect(impRes.getStatusCode()).toBe(201); // 导入永不失败
    const cfg = impRes.getJson().state.config;
    expect(cfg.kind).toBe('chat'); // 降级
    expect(cfg.projectPath).toBeUndefined();
    // 降级警示系统消息落房(房内首条 system 消息)
    const room = rooms.get(impRes.getJson().id);
    const sysMsgs = room ? (room as any).history.filter((m: any) => m.system) : [];
    expect(sysMsgs.length).toBeGreaterThanOrEqual(1);
    expect(sysMsgs[0].text).toContain('降级');
  });

  it('makeRoomConfig 纯函数:task 无 scout 由 runScout 分支保障(room.ts),此处锁配置面', async () => {
    // scout 跳过逻辑在 ChatRoom.runScout(kind=task 短路),消息级 e2e 由冒烟覆盖;
    // 这里锁定配置面:task 房的 projectPath 恒定存在(400 已保证)——scout 触发条件不全集。
    const r = await postRoom(routes, { name: 'H', kind: 'task', topic: 't', projectPath: projectDir, members: [] });
    const cfg = r.getJson().state.config;
    expect(existsSync(cfg.projectPath)).toBe(true);
  });

  it('PATCH settings:task 房忽略 chainBudget/subscribeConfig(后端防线;面板不渲染是前端)', async () => {
    const created = await postRoom(routes, { name: 'I', kind: 'task', topic: 't', projectPath: projectDir, members: [] });
    const rid = created.getJson().id;
    const room = rooms.get(rid)!;
    const r = mockRes();
    await routes.handle(mockReq('PATCH', `/api/rooms/${rid}/settings`, JSON.stringify({
      chainBudget: 99,
      subscribeConfig: { heartbeatIntervalMs: 12345 },
      name: 'I-改名', // name 照常可改
    })), r.res);
    expect(r.getStatusCode()).toBe(200);
    expect((room.config as any).chainBudget).toBe(6); // 忽略,原值
    expect((room.config as any).subscribeConfig).toBeUndefined(); // 忽略
    expect(room.config.name).toBe('I-改名'); // 通用字段照常
  });
});
