// 斜杠命令层测试(工单08):
// - skills 扫描纯函数(用户级+项目级合并,无 projectPath 仅用户级)
// - detectSlashCommand 纯函数(web utils 同层范式,经 @server 别名? 不——mentions 是前端真源,
//   后端无对应解析;此处测 server skills 扫描 + REST 端点接线)
// - REST:/api/rooms/:id/skills、/model、/compact(隔离 REPO_ROOT 同范式)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AppConfig } from '../src/server/config';
import type { ChatRoom } from '../src/core/room';
import { MessageBus } from '../src/core/bus';
import { listSkills } from '../src/core/skills';

const ISOLATION_ROOT = path.join(tmpdir(), `ai-chatroom-slash-test-${process.pid}`);

async function loadIsolatedRoutes() {
  vi.resetModules();
  vi.doMock('../src/paths', () => ({ REPO_ROOT: ISOLATION_ROOT }));
  const { createRoutes } = await import('../src/server/routes');
  return createRoutes;
}

type CreateRoutes = Awaited<ReturnType<typeof loadIsolatedRoutes>>;

function mockReq(method: string, url: string, body?: string): any {
  const stream = new Readable() as any;
  stream._read = () => {};
  stream.method = method;
  stream.url = url;
  stream.headers = {};
  if (body) stream.push(Buffer.from(body));
  stream.push(null);
  return stream;
}

function mockRes() {
  let statusCode = 200;
  let body = '';
  const res = new EventEmitter() as any;
  res.writeHead = (code: number) => { statusCode = code; };
  res.setHeader = () => {};
  res.end = (chunk?: any) => {
    if (chunk) body += chunk.toString();
    res.emit('finish');
  };
  return { res, status: () => statusCode, json: () => { try { return body ? JSON.parse(body) : null; } catch { return body; } } };
}

const mockConfig: AppConfig = {
  admin: { adapter: 'claude', model: 'haiku', allowedTools: 'Read Glob Grep', timeoutMs: 30000, maxRetries: 2 },
  server: { port: 3220, host: '127.0.0.1' },
  speakTimeoutMs: 0,
  adapters: { claude: { displayName: 'Claude', kind: 'claude', command: 'node', args: [] } },
  summary: { model: 'haiku', autoThreshold: 30, privateThreshold: 20, compactThreshold: 40 },
};

describe('skills 扫描纯函数', () => {
  const fakeHome = path.join(ISOLATION_ROOT, 'home');
  const fakeProj = path.join(ISOLATION_ROOT, 'proj');

  beforeEach(async () => {
    // 隔离 homedir(经环境变量不可行——listSkills 用 homedir();此处测真实目录的存在性分支,
    // 用 monkey-patch homedir)
    vi.resetModules();
    mkdirSync(path.join(fakeHome, '.claude', 'skills', 'alpha'), { recursive: true });
    mkdirSync(path.join(fakeHome, '.claude', 'skills', 'beta'), { recursive: true });
    mkdirSync(path.join(fakeProj, '.claude', 'skills', 'gamma'), { recursive: true });
    await writeFile(path.join(fakeHome, '.claude', 'skills', 'alpha', 'SKILL.md'), 'x');
  });

  afterEach(async () => {
    vi.resetModules();
    await rm(ISOLATION_ROOT, { recursive: true, force: true });
    vi.doUnmock('node:os');
  });

  it('用户级 + 项目级合并;无 projectPath 仅用户级;目录不存在返回空', async () => {
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<any>('node:os');
      return { ...actual, homedir: () => fakeHome };
    });
    const { listSkills: ls } = await import('../src/core/skills');
    const both = ls(fakeProj);
    expect(both.map((s) => s.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(both.find((s) => s.name === 'gamma')!.from).toBe('project');
    expect(both.find((s) => s.name === 'alpha')!.from).toBe('user');
    const userOnly = ls(undefined);
    expect(userOnly.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
    const empty = ls(path.join(ISOLATION_ROOT, 'not-exist'));
    expect(empty.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
  });
});

describe('斜杠命令 REST 端点', () => {
  let bus: MessageBus;
  let rooms: Map<string, ChatRoom>;
  let routes: ReturnType<CreateRoutes>;

  beforeEach(async () => {
    mkdirSync(ISOLATION_ROOT, { recursive: true });
    bus = new MessageBus();
    rooms = new Map();
    const createRoutes = await loadIsolatedRoutes();
    routes = createRoutes(bus, mockConfig, rooms);
    // 建一个任务房(经 REST,含真实成员)
    const r = mockRes();
    await routes.handle(mockReq('POST', '/api/rooms', JSON.stringify({
      name: 'T', kind: 'task', topic: 'x', projectPath: ISOLATION_ROOT,
      members: [{ name: '工程师', adapter: 'claude', persona: 'p' }],
    })), r.res);
  });

  afterEach(async () => {
    vi.doUnmock('../src/paths');
    vi.resetModules();
    await rm(ISOLATION_ROOT, { recursive: true, force: true });
  });

  it('GET /api/rooms/:id/skills 返回数组结构', async () => {
    const first = rooms.values().next().value as ChatRoom;
    const r = mockRes();
    await routes.handle(mockReq('GET', `/api/rooms/${first.config.id}/skills`), r.res);
    expect(r.status()).toBe(200);
    expect(Array.isArray(r.json().skills)).toBe(true);
  });

  it('POST /model:更新成员 --model 并持久化;非法 model(以 - 开头)→ 400', async () => {
    const first = rooms.values().next().value as ChatRoom;
    const mid = first.config.members[0]!.id;
    const ok = mockRes();
    await routes.handle(mockReq('POST', `/api/rooms/${first.config.id}/model`, JSON.stringify({ memberId: mid, model: 'sonnet' })), ok.res);
    expect(ok.status()).toBe(200);
    expect(first.config.members[0]!.extraArgs).toContain('sonnet');

    const bad = mockRes();
    await routes.handle(mockReq('POST', `/api/rooms/${first.config.id}/model`, JSON.stringify({ memberId: mid, model: '--evil' })), bad.res);
    expect(bad.status()).toBe(400);
  });

  it('POST /compact:无 session(stateful 未发言)→ 409 + 系统消息提示', async () => {
    const first = rooms.values().next().value as ChatRoom;
    const r = mockRes();
    await routes.handle(mockReq('POST', `/api/rooms/${first.config.id}/compact`, JSON.stringify({})), r.res);
    expect(r.status()).toBe(409);
    expect(r.json().reason).toBe('no-session');
  });
});
