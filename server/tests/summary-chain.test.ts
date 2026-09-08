// 单测:ChatRoom 摘要串行链与槽位化合并(D3 并发修复)。
// 场景:多写者(公聊摘要 × 双成员私聊纪要)并发生成,写回必须经串行链排队合并,
// 链内读最新、只覆写各自槽位——任何一方不得抹掉他人槽位。
// 隔离:store 的 REPO_ROOT 经 vi.doMock 注入临时目录(同 rooms-store.test.ts 范式)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ChatMessage } from '../src/core/types';
import type { SpeakRequest } from '../src/adapters/base';

const ISOLATION_ROOT = path.join(tmpdir(), `ai-chatroom-summary-chain-test-${process.pid}`);

async function loadModules() {
  vi.resetModules();
  vi.doMock('../src/paths', () => ({ REPO_ROOT: ISOLATION_ROOT }));
  const { ChatRoom, makeRoomConfig } = await import('../src/core/room');
  const { MessageBus } = await import('../src/core/bus');
  const { registerAdapter } = await import('../src/adapters/index');
  return { ChatRoom, makeRoomConfig, MessageBus, registerAdapter };
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

let M: Modules;

beforeEach(async () => {
  await rm(ISOLATION_ROOT, { recursive: true, force: true });
  M = await loadModules();
});

afterEach(async () => {
  vi.doUnmock('../src/paths');
  vi.resetModules();
  await rm(ISOLATION_ROOT, { recursive: true, force: true });
});

/**
 * 构造 ChatRoom 并注入可控延迟的 fake adapter。
 * speakImpl 按 prompt 特征路由:纪要 prompt(含成员名锚点)与摘要 prompt(含【管理员】)。
 */
async function makeRoom(speakImpl: (req: SpeakRequest) => Promise<{ status: 'ok'; result: string }>) {
  const { ChatRoom, makeRoomConfig, MessageBus, registerAdapter } = M;
  registerAdapter('fake', {
    speak: (req) => ({
      done: speakImpl(req).then((r) => ({ status: r.status, result: r.result, durationMs: 1 })),
      cancel: () => {},
    }),
  });
  const bus = new MessageBus();
  const cfg = makeRoomConfig({
    name: '并发测试房',
    topic: '槽位化合并',
    members: [
      { name: '甲', adapter: 'fake', persona: 'p' },
      { name: '乙', adapter: 'fake', persona: 'p' },
    ],
  });
  const room = new ChatRoom(
    cfg,
    bus,
    { fake: { kind: 'fake', command: 'echo', args: [] } },
    { adapter: 'fake', model: 'haiku', allowedTools: '', timeoutMs: 5000, maxRetries: 2 },
    {
      persistRoom: async () => {},
      loadMessages: async () => [],
      rewriteMessages: async () => {},
    },
    { model: 'haiku', autoThreshold: 1, privateThreshold: 1, compactThreshold: 0 },
  );
  await room.restore();
  return { room, idA: cfg.members[0]!.id, idB: cfg.members[1]!.id };
}

/** 经真实 pushMessage 入口落一条消息(触发完整的自动摘要/纪要管线) */
async function land(room: InstanceType<Modules['ChatRoom']>, msg: Partial<ChatMessage>): Promise<void> {
  await room['pushMessage']({
    id: `msg_${Math.random().toString(36).slice(2, 8)}`,
    roomId: room.id,
    from: 'user', fromName: '用户',
    text: 'x', ts: Date.now(),
    ...msg,
  } as ChatMessage);
}

describe('ChatRoom 摘要串行链与槽位化合并', () => {
  it('双成员纪要同拍并发完成:两个纪要槽位都存活(旧代码后写者抹掉先写者)', async () => {
    const { room, idA, idB } = await makeRoom(async (req) => {
      // 纪要 prompt 特征:第一人称纪要指令;按成员名锚点区分
      if (req.prompt.includes('第一人称')) {
        const isA = req.prompt.includes('【甲】');
        await new Promise((r) => setTimeout(r, 50)); // 同拍完成:制造读-写交错窗口
        return { status: 'ok', result: isA ? '甲的纪要' : '乙的纪要' };
      }
      return { status: 'ok', result: '无关输出' };
    });

    // 两条私聊(阈值语义 uncovered > 1):同时触发甲、乙双方纪要
    await land(room, { from: idA, fromName: '甲', text: '密谋一', audience: [idB] });
    await land(room, { from: idB, fromName: '乙', text: '密谋二', audience: [idA] });

    // 等待两路纪要生成 + 链内合并落定
    await new Promise((r) => setTimeout(r, 500));

    const summary = await room.getSummary();
    expect(summary?.privateDigests?.[idA]?.text).toBe('甲的纪要');
    expect(summary?.privateDigests?.[idB]?.text).toBe('乙的纪要'); // 旧代码:乙的写回抹掉甲的槽位
  });

  it('摘要生成窗口内写入的纪要:摘要落盘后仍存活(链内读最新合并)', async () => {
    const { room, idA, idB } = await makeRoom(async (req) => {
      if (req.prompt.includes('【管理员】')) {
        await new Promise((r) => setTimeout(r, 150)); // 摘要慢生成:制造竞态窗口
        return { status: 'ok', result: '### 1. 核心议题\n并发期间的公聊摘要' };
      }
      if (req.prompt.includes('第一人称')) {
        await new Promise((r) => setTimeout(r, 30)); // 纪要快完成:落在摘要窗口内
        return { status: 'ok', result: '窗口内完成的纪要' };
      }
      return { status: 'ok', result: '无关输出' };
    });

    // 并发触发:公聊摘要(两条公聊越阈值)与双成员纪要(两条私聊越阈值)同窗进行
    await land(room, { text: '公聊一' });
    await land(room, { text: '公聊二' });
    await land(room, { from: idA, fromName: '甲', text: '密谋一', audience: [idB] });
    await land(room, { from: idB, fromName: '乙', text: '密谋二', audience: [idA] });

    await new Promise((r) => setTimeout(r, 600));

    const summary = await room.getSummary();
    expect(summary?.text).toContain('并发期间的公聊摘要'); // 摘要自己的槽位写入了
    expect(summary?.privateDigests?.[idA]?.text).toBe('窗口内完成的纪要'); // 窗口内写入的纪要存活
    expect(summary?.privateDigests?.[idB]?.text).toBe('窗口内完成的纪要'); // (旧代码:整体覆盖互吞)
  });
});
