// 房间配置持久化(v2 新增,补 v1 最大 SSOT 缺口):
// data/rooms.json = { [roomId]: RoomConfig }(含 member.sessionIds)。
// 写穿时机:建房/成员增删/设置变更/每条成员消息完成后(与 JSONL 顺序一致)。
// 原子写:temp + rename;Windows 下 rename 撞 EPERM(杀毒占用)重试一次。

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RoomConfig } from '../core/types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'rooms.json');

type RoomsFile = Record<string, RoomConfig>;

async function readAll(): Promise<RoomsFile> {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as RoomsFile;
  } catch (e) {
    console.error('[rooms-store] rooms.json 损坏,从空开始:', e);
    return {};
  }
}

/** 原子写:temp + rename;EPERM 重试一次(Windows 杀毒软件常见)。 */
async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = file + '.tmp';
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, file);
  } catch (e: any) {
    if (e?.code === 'EPERM') {
      await new Promise((r) => setTimeout(r, 50));
      await rename(tmp, file); // 重试一次
      return;
    }
    throw e;
  }
}

/** 写穿一个房间(config 全量替换该 entry)。 */
export async function persistRoom(cfg: RoomConfig): Promise<void> {
  const all = await readAll();
  all[cfg.id] = cfg;
  await mkdir(DATA_DIR, { recursive: true });
  await atomicWrite(FILE, JSON.stringify(all, null, 2));
}

/** 删除一个房间的 config(JSONL 历史保留,可回看)。 */
export async function deleteRoom(roomId: string): Promise<void> {
  const all = await readAll();
  delete all[roomId];
  await mkdir(DATA_DIR, { recursive: true });
  await atomicWrite(FILE, JSON.stringify(all, null, 2));
}

/** 启动时全量加载(复活房间;编排运行态不持久化,复活后 idle)。 */
export async function loadAllRooms(): Promise<RoomConfig[]> {
  const all = await readAll();
  return Object.values(all).sort((a, b) => a.createdAt - b.createdAt);
}
