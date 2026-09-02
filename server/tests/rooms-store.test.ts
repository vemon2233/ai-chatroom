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
});
