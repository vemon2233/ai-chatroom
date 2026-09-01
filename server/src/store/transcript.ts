// 聊天记录持久化:每房间一个 JSONL 文件,追加写入,重开可回放。

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from '../core/types';
import { REPO_ROOT } from '../server/config';

const DATA_DIR = path.join(REPO_ROOT, 'data', 'rooms');

async function ensureDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

function fileFor(roomId: string) {
  // 防路径穿越
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_DIR, `${safe}.jsonl`);
}

export async function appendMessage(msg: ChatMessage): Promise<void> {
  await ensureDir();
  await appendFile(fileFor(msg.roomId), JSON.stringify(msg) + '\n', 'utf8');
}

export async function loadRoomMessages(roomId: string): Promise<ChatMessage[]> {
  const f = fileFor(roomId);
  if (!existsSync(f)) return [];
  const raw = await readFile(f, 'utf8');
  const out: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // 损坏行跳过(进程被杀时可能的半行)
    }
  }
  return out;
}

export async function listRoomIds(): Promise<string[]> {
  if (!existsSync(DATA_DIR)) return [];
  const files = await readdir(DATA_DIR);
  return files.filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
}
