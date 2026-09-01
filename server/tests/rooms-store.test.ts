// 单测:rooms.json 持久化往返(建→写穿→重启加载→复活配置含 sessionIds)。

import { describe, it, expect, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { persistRoom, loadAllRooms, deleteRoom } from '../src/store/rooms';
import { REPO_ROOT } from '../src/server/config';
import type { RoomConfig } from '../src/core/types';

// 路径与 store 同源:REPO_ROOT/data/rooms.json。测试前后自清理。
// 注意:断言前先备份/恢复真实数据文件由 afterAll 兜底(测试场景为隔离环境)。
describe('rooms store', () => {
  const FILE = path.join(REPO_ROOT, 'data', 'rooms.json');

  it('写穿 → 全量加载往返(含 sessionIds)', async () => {
    await rm(FILE, { force: true });
    const cfg: RoomConfig = {
      id: 'room_t1',
      name: '房',
      topic: '题',
      chainBudget: 8,
      speechLength: 'long',
      toolPermission: 'readwrite',
      members: [{
        id: 'm1', name: '甲', adapter: 'claude', persona: 'p', color: '#111',
        sessionIds: { claude: 'sess-abc' },
      }],
      createdAt: 123,
    };
    await persistRoom(cfg);
    const loaded = await loadAllRooms();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.members[0]!.sessionIds?.claude).toBe('sess-abc');
    expect(loaded[0]!.chainBudget).toBe(8);
  });

  it('删除后不再加载', async () => {
    await deleteRoom('room_t1');
    expect(await loadAllRooms()).toHaveLength(0);
  });

  it('损坏的 rooms.json 容错为空', async () => {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, '{broken json', 'utf8');
    expect(await loadAllRooms()).toEqual([]);
    await rm(FILE, { force: true });
  });

  it('文件不存在 → 空', async () => {
    await rm(FILE, { force: true });
    expect(await loadAllRooms()).toEqual([]);
  });

  afterAll(async () => {
    await rm(FILE, { force: true });
    await rm(FILE + '.tmp', { force: true });
  });
});
