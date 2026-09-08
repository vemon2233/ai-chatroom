// 单测:rooms.json 持久化往返(建→写穿→重启加载→复活配置含 sessionIds)。
// 隔离:store 的 DATA_DIR 是模块加载时求值的常量,常规手段改不了——
// 用 vi.resetModules + 动态 import 在每例前以独立 REPO_ROOT 重新加载模块,
// 测试目录完全隔离,绝不触碰真实 data/rooms.json(曾发生测试清库事故)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const ISOLATION_ROOT = path.join(tmpdir(), `ai-chatroom-rooms-store-test-${process.pid}`);
const FILE = path.join(ISOLATION_ROOT, 'data', 'rooms.json');

/** 以隔离 REPO_ROOT 重新加载 store/rooms(拿到绑定隔离路径的模块实例)。 */
async function loadIsolatedStore() {
  vi.resetModules();
  // paths.ts 被 store 引用;先 mock 掉它
  vi.doMock('../src/paths', () => ({ REPO_ROOT: ISOLATION_ROOT }));
  return import('../src/store/rooms');
}

type Store = Awaited<ReturnType<typeof loadIsolatedStore>>;

let store: Store;

beforeEach(async () => {
  await rm(ISOLATION_ROOT, { recursive: true, force: true });
  store = await loadIsolatedStore();
});

afterEach(async () => {
  vi.doUnmock('../src/paths');
  vi.resetModules();
  await rm(ISOLATION_ROOT, { recursive: true, force: true });
});

describe('rooms store', () => {
  it('写穿 → 全量加载往返(含 sessionIds)', async () => {
    const cfg = {
      id: 'room_t1',
      name: '房',
      topic: '题',
      chainBudget: 8,
      speechLength: 'long' as const,
      toolPermission: 'readwrite' as const,
      members: [{
        id: 'm1', name: '甲', adapter: 'claude', persona: 'p', color: '#111',
        sessionIds: { claude: 'sess-abc' },
      }],
      createdAt: 123,
    };
    await store.persistRoom(cfg);
    const loaded = await store.loadAllRooms();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.members[0]!.sessionIds?.claude).toBe('sess-abc');
    expect(loaded[0]!.chainBudget).toBe(8);
  });

  it('删除后不再加载', async () => {
    await store.persistRoom({
      id: 'room_t2', name: 'n', topic: 't', chainBudget: 1, speechLength: 'short',
      toolPermission: 'readonly', members: [], createdAt: 1,
    });
    await store.deleteRoom('room_t2');
    expect(await store.loadAllRooms()).toHaveLength(0);
  });

  it('损坏的 rooms.json 容错为空', async () => {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, '{broken json', 'utf8');
    expect(await store.loadAllRooms()).toEqual([]);
  });

  it('文件不存在 → 空', async () => {
    expect(await store.loadAllRooms()).toEqual([]);
  });

  it('写互斥:并发写两个房间不丢更新(串行化链)', async () => {
    // 并发 persist 两个房间;串行化保证两者都在
    await Promise.all([
      store.persistRoom({ id: 'room_a', name: 'a', topic: 't', chainBudget: 1, speechLength: 'short', toolPermission: 'readonly', members: [], createdAt: 1 }),
      store.persistRoom({ id: 'room_b', name: 'b', topic: 't', chainBudget: 1, speechLength: 'short', toolPermission: 'readonly', members: [], createdAt: 2 }),
    ]);
    const loaded = await store.loadAllRooms();
    expect(loaded.map((r) => r.id).sort()).toEqual(['room_a', 'room_b']);
  });

  it('真实数据不受污染:隔离目录外无写入', async () => {
    await store.persistRoom({ id: 'room_iso', name: 'x', topic: 't', chainBudget: 1, speechLength: 'short', toolPermission: 'readonly', members: [], createdAt: 1 });
    // 真实仓库 data 目录不应出现该房间
    const real = path.resolve(process.cwd(), '..', 'data', 'rooms.json');
    const content = await readFile(real, 'utf8').catch(() => '');
    expect(content).not.toContain('room_iso');
  });

  it('clearMessages 清空消息并清除全部成员 sessionIds 且写穿持久化', async () => {
    const { ChatRoom, makeRoomConfig } = await import('../src/core/room');
    const { MessageBus } = await import('../src/core/bus');
    const bus = new MessageBus();
    const cfg = {
      id: 'room_clear_test',
      name: '测试房',
      topic: '测试话题',
      members: [
        { id: 'm1', name: '甲', adapter: 'claude', persona: 'p', color: '#111', sessionIds: { claude: 'sess-1' } },
        { id: 'm2', name: '乙', adapter: 'claude', persona: 'p', color: '#222', sessionIds: { claude: 'sess-2' } },
      ],
      createdAt: 123,
    };
    const roomConfig = makeRoomConfig(cfg);
    const persistence = {
      persistRoom: (c: any) => store.persistRoom(c),
      loadMessages: async () => [],
      rewriteMessages: async () => {},
      appendMessage: async () => {},
    };
    const room = new ChatRoom(
      roomConfig,
      bus,
      { claude: { kind: 'claude', command: 'echo', args: [] } },
      { adapter: 'claude', model: 'haiku', allowedTools: '', timeoutMs: 1000, maxRetries: 1 },
      persistence,
    );
    await store.persistRoom(roomConfig);

    await room.clearMessages();

    expect(roomConfig.members[0]!.sessionIds).toBeUndefined();
    expect(roomConfig.members[1]!.sessionIds).toBeUndefined();

    // 验证重新从存储加载，sessionIds 确实已被写穿清除
    const loaded = await store.loadAllRooms();
    const found = loaded.find((r) => r.id === roomConfig.id);
    expect(found).toBeDefined();
    expect(found!.members[0]!.sessionIds).toBeUndefined();
    expect(found!.members[1]!.sessionIds).toBeUndefined();
  });

  it('restore 时历史中已含 scout 消息，同步标记侦察完成避免重复触发', async () => {
    const { ChatRoom, makeRoomConfig } = await import('../src/core/room');
    const { MessageBus } = await import('../src/core/bus');
    const bus = new MessageBus();
    const cfg = {
      id: 'room_scout_restore_test',
      name: '侦察测试房',
      topic: '项目研讨',
      projectPath: 'd:/mock/project',
      members: [
        { id: 'm1', name: '甲', adapter: 'claude', persona: 'p', color: '#111' },
      ],
      createdAt: 123,
    };
    const roomConfig = makeRoomConfig(cfg);
    const existingMessages = [
      {
        id: 'scout_msg_1',
        roomId: roomConfig.id,
        from: 'scout',
        fromName: '🔍 侦察员',
        text: '已完成项目目录勘探。',
        ts: Date.now() - 5000,
      },
    ];
    const persistence = {
      persistRoom: async () => {},
      loadMessages: async () => existingMessages as any,
      rewriteMessages: async () => {},
      appendMessage: async () => {},
    };
    const room = new ChatRoom(
      roomConfig,
      bus,
      { claude: { kind: 'claude', command: 'echo', args: [] } },
      { adapter: 'claude', model: 'haiku', allowedTools: '', timeoutMs: 1000, maxRetries: 1 },
      persistence,
    );

    await room.restore();

    // 验证 admin 内部已记录侦察完成，再次 ensureScout 直接返回 null
    const res = await (room as any).admin.ensureScout(roomConfig.projectPath);
    expect(res).toBeNull();
  });
});


