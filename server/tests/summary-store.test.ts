import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../src/paths';
import {
  saveSummarySnapshot,
  getSummarySnapshot,
  listSummarySnapshots,
  getSummary,
} from '../src/store/summary';
import type { DiscussionSummary } from '../src/core/types';

describe('summaryStore 摘要快照持久化与历史查询', () => {
  const testRoomId = 'test_room_snap_001';
  const testDirectId = 'test_char_snap_001';

  const roomSnapDir = path.join(REPO_ROOT, 'data', 'summaries', 'rooms', testRoomId);
  const directSnapDir = path.join(REPO_ROOT, 'data', 'summaries', 'direct', testDirectId);
  const roomLegacyFile = path.join(REPO_ROOT, 'data', 'summaries', 'rooms', `${testRoomId}.json`);

  beforeEach(async () => {
    await rm(roomSnapDir, { recursive: true, force: true });
    await rm(directSnapDir, { recursive: true, force: true });
    await rm(roomLegacyFile, { force: true });
  });

  afterEach(async () => {
    await rm(roomSnapDir, { recursive: true, force: true });
    await rm(directSnapDir, { recursive: true, force: true });
    await rm(roomLegacyFile, { force: true });
  });

  it('saveSummarySnapshot 正确保存快照文件并更新兼容层单文件', async () => {
    const sum1: DiscussionSummary = {
      text: '第一次公聊大纲总结',
      coveredMessageId: 'm10',
      updatedAt: 1000,
      messageCount: 10,
    };

    const snap1 = await saveSummarySnapshot('room', testRoomId, sum1, 'manual');
    expect(snap1.id).toMatch(/^sum_1000_/);
    expect(snap1.trigger).toBe('manual');
    expect(snap1.text).toBe('第一次公聊大纲总结');

    // 验证快照文件存在
    const file1 = path.join(roomSnapDir, `${snap1.id}.json`);
    expect(existsSync(file1)).toBe(true);

    // 验证旧单文件兼容层存在
    expect(existsSync(roomLegacyFile)).toBe(true);

    // 验证 getSummarySnapshot
    const detail = await getSummarySnapshot('room', testRoomId, snap1.id);
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(snap1.id);
    expect(detail?.text).toBe('第一次公聊大纲总结');
    expect(detail?.coveredMessageId).toBe('m10');
  });

  it('listSummarySnapshots 按时间倒序返回多份快照', async () => {
    const sum1: DiscussionSummary = {
      text: '第一份摘要',
      coveredMessageId: 'm10',
      updatedAt: 1000,
      messageCount: 10,
    };
    const sum2: DiscussionSummary = {
      text: '第二份摘要',
      coveredMessageId: 'm25',
      updatedAt: 2500,
      messageCount: 25,
      privateDigests: {
        agent_a: { text: 'agent A 的密信备忘', coveredMessageId: 'p5', updatedAt: 2500 },
      },
    };

    const snap1 = await saveSummarySnapshot('room', testRoomId, sum1, 'auto');
    const snap2 = await saveSummarySnapshot('room', testRoomId, sum2, 'manual');

    const list = await listSummarySnapshots('room', testRoomId);
    expect(list.length).toBe(2);
    // 最新时间排在前面
    expect(list[0]!.id).toBe(snap2.id);
    expect(list[0]!.createdAt).toBe(2500);
    expect(list[0]!.messageCount).toBe(25);
    expect(list[0]!.trigger).toBe('manual');

    expect(list[1]!.id).toBe(snap1.id);
    expect(list[1]!.createdAt).toBe(1000);
    expect(list[1]!.trigger).toBe('auto');

    // 验证 getSummary 自动获取最新快照
    const latest = await getSummary('room', testRoomId);
    expect(latest?.text).toBe('第二份摘要');
    expect(latest?.privateDigests?.agent_a?.text).toBe('agent A 的密信备忘');
  });

  it('存量旧单文件自愈：旧文件能被自动升级补录为初始快照', async () => {
    // 模拟存量老系统只有单文件，没有快照子目录
    const roomsBaseDir = path.join(REPO_ROOT, 'data', 'summaries', 'rooms');
    if (!existsSync(roomsBaseDir)) {
      await mkdir(roomsBaseDir, { recursive: true });
    }
    const legacyData: DiscussionSummary = {
      text: '存量老系统的单份历史摘要',
      updatedAt: 500,
      messageCount: 8,
      coveredMessageId: 'm8',
    };
    await writeFile(roomLegacyFile, JSON.stringify(legacyData, null, 2), 'utf8');

    // 此时快照目录不存在，调用 listSummarySnapshots 应该自愈
    const list = await listSummarySnapshots('room', testRoomId);
    expect(list.length).toBe(1);
    expect(list[0]!.messageCount).toBe(8);
    expect(list[0]!.coveredMessageId).toBe('m8');

    // 验证生成的快照能够正确读取详情
    const detail = await getSummarySnapshot('room', testRoomId, list[0]!.id);
    expect(detail?.text).toBe('存量老系统的单份历史摘要');
  });

  it('room 与 direct 作用域物理隔离', async () => {
    const roomSum: DiscussionSummary = { text: '群聊总结', updatedAt: 100, messageCount: 5 };
    const directSum: DiscussionSummary = { text: '私聊总结', updatedAt: 200, messageCount: 6 };

    await saveSummarySnapshot('room', testRoomId, roomSum);
    await saveSummarySnapshot('direct', testDirectId, directSum);

    const roomList = await listSummarySnapshots('room', testRoomId);
    const directList = await listSummarySnapshots('direct', testDirectId);

    expect(roomList.length).toBe(1);
    expect(directList.length).toBe(1);
    expect(roomList[0]!.scope).toBe('room');
    expect(directList[0]!.scope).toBe('direct');
  });
});
