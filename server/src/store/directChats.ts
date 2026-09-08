// 角色一对一私聊持久化: 每角色一个独立的 JSONL 文件，存放在 data/direct_chats/<characterId>.jsonl
// 与群聊房间(rooms)彻底物理隔离，避免相互污染。

import { appendFile, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage, DirectChatMeta } from '../core/types';
import { REPO_ROOT } from '../paths';

const DATA_DIR = path.join(REPO_ROOT, 'data', 'direct_chats');
const META_FILE = path.join(REPO_ROOT, 'data', 'direct_chats.json');

let writeMetaChain: Promise<unknown> = Promise.resolve();

async function ensureDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

function fileFor(characterId: string) {
  const safe = characterId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_DIR, `${safe}.jsonl`);
}

async function readAllMetas(): Promise<Record<string, DirectChatMeta>> {
  if (!existsSync(META_FILE)) return {};
  try {
    const raw = await readFile(META_FILE, 'utf8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export async function loadDirectMeta(characterId: string): Promise<DirectChatMeta> {
  const all = await readAllMetas();
  return all[characterId] || {};
}

export async function saveDirectMeta(characterId: string, meta: DirectChatMeta): Promise<void> {
  const task = writeMetaChain.then(async () => {
    const all = await readAllMetas();
    if (!meta || !meta.userPersona) {
      delete all[characterId];
    } else {
      all[characterId] = meta;
    }
    await writeFile(META_FILE, JSON.stringify(all, null, 2), 'utf8');
  });
  writeMetaChain = task.then(() => {}, () => {});
  return task;
}

export async function appendDirectMessage(characterId: string, msg: ChatMessage): Promise<void> {
  await ensureDir();
  await appendFile(fileFor(characterId), JSON.stringify(msg) + '\n', 'utf8');
}

export async function loadDirectMessages(characterId: string): Promise<ChatMessage[]> {
  const f = fileFor(characterId);
  if (!existsSync(f)) return [];
  const raw = await readFile(f, 'utf8');
  const out: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // 损坏行容错跳过
    }
  }
  return out;
}

export async function rewriteDirectMessages(characterId: string, messages: ChatMessage[]): Promise<void> {
  await ensureDir();
  const content = messages.map((m) => JSON.stringify(m)).join('\n') + (messages.length > 0 ? '\n' : '');
  await writeFile(fileFor(characterId), content, 'utf8');
}

export async function resetDirectChat(characterId: string): Promise<void> {
  await ensureDir();
  await writeFile(fileFor(characterId), '', 'utf8');
}

export async function deleteDirectChat(characterId: string): Promise<void> {
  const f = fileFor(characterId);
  if (existsSync(f)) {
    await unlink(f).catch(() => { });
  }
  await saveDirectMeta(characterId, {});
}

