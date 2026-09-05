// 聊天记录持久化:每房间一个 JSONL 文件,追加写入,重开可回放。

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from '../core/types';
import { inferHandshakeFromText } from '../core/modes/subscribe/audience';
import { REPO_ROOT } from '../paths';

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

  // 针对历史旧消息: 兼容推算补齐缺少 privateRound / handshake 的私聊消息
  let threadSeq = 0;
  const pairThreadMap = new Map<string, number>();
  for (const m of out) {
    if (m.audience && m.audience.length > 0) {
      const pairKey = [m.from, ...m.audience].sort().join(':');
      if (m.privateRound == null) {
        if (!pairThreadMap.has(pairKey)) {
          threadSeq++;
          pairThreadMap.set(pairKey, threadSeq);
        }
        m.privateRound = pairThreadMap.get(pairKey)!;
      } else {
        pairThreadMap.set(pairKey, m.privateRound);
        if (m.privateRound > threadSeq) threadSeq = m.privateRound;
      }

      // 若历史消息缺少 handshake/privateAction，智能语义兜底推算
      if (!m.handshake && !m.privateAction) {
        const inferred = inferHandshakeFromText(m.text);
        if (inferred) {
          m.handshake = inferred;
          m.privateAction = inferred;
        }
      }
    }
  }

  return out;
}

export async function rewriteRoomMessages(roomId: string, messages: ChatMessage[]): Promise<void> {
  await ensureDir();
  const content = messages.map((m) => JSON.stringify(m) + '\n').join('');
  await writeFile(fileFor(roomId), content, 'utf8');
}
