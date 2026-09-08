// 单测:接棒解析 + 成员名匹配(移植 v1 tests/baton-match.test.ts 全部断言)。

import { describe, it, expect } from 'vitest';
import { parseBaton } from '../src/core/modes/baton/baton';
import { matchMemberByName } from '../src/core/naming';
import { buildPrompt } from '../src/core/prompt';
import { historyText } from '../src/core/render';
import type { ChatMessage, MemberConfig, RoomConfig } from '../src/core/types';

const members = [
  { id: 'm1', name: '工程师' },
  { id: 'm2', name: '工程师2' },
  { id: 'm3', name: '工程师3' },
  { id: 'm4', name: '工程师4' },
];

describe('parseBaton:接棒行解析(新语法 <接棒>,兼容旧【接棒】)', () => {
  it('@工程师3 命中3号', () => {
    expect(parseBaton('正文\n<接棒>@工程师3', members, 'm2').nextMemberId).toBe('m3');
  });
  it('旧语法【接棒】同样解析(resume 旧 session 记忆惯性)', () => {
    expect(parseBaton('正文\n【接棒】@工程师3', members, 'm2').nextMemberId).toBe('m3');
  });
  it('@工程师2 命中2号', () => {
    expect(parseBaton('正文\n<接棒>@工程师2', members, 'm1').nextMemberId).toBe('m2');
  });
  it('@工程师 命中1号(纯名)', () => {
    expect(parseBaton('正文\n<接棒>@工程师', members, 'm3').nextMemberId).toBe('m1');
  });
  it('@工程师4 命中4号', () => {
    expect(parseBaton('正文\n<接棒>@工程师4', members, 'm2').nextMemberId).toBe('m4');
  });
  it('结束', () => {
    expect(parseBaton('正文\n<接棒>结束', members, 'm2').endDiscussion).toBe(true);
    expect(parseBaton('正文\n【接棒】结束', members, 'm2').endDiscussion).toBe(true);
  });
  it('自传无效(→ 无指令)', () => {
    expect(parseBaton('正文\n<接棒>@工程师2', members, 'm2').nextMemberId).toBeUndefined();
  });
  it('名字对不上 → 无效', () => {
    expect(parseBaton('正文\n<接棒>@不存在的人', members, 'm2').nextMemberId).toBeUndefined();
  });
  it('没有接棒行 → 无指令', () => {
    const r = parseBaton('我说完了,没有下文', members, 'm2');
    expect(r.nextMemberId).toBeUndefined();
    expect(r.endDiscussion).toBeUndefined();
  });
});

describe('matchMemberByName:直接匹配', () => {
  it('match 工程师3', () => expect(matchMemberByName('工程师3', members)?.id).toBe('m3'));
  it('match 工程师', () => expect(matchMemberByName('工程师', members)?.id).toBe('m1'));
  it('match 不存在', () => expect(matchMemberByName('产品经理', members)).toBeUndefined());
});

describe('historyText', () => {
  it('带发言者名,默认取最近 40 条', () => {
    const msgs: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
      id: `id${i}`, roomId: 'r', from: 'user', fromName: `人${i}`, text: `话${i}`, ts: i,
    }));
    const text = historyText(msgs);
    expect(text).not.toContain('话0');
    expect(text).toContain('话49');
    expect(text).toContain('**[人49] (全员公聊)：**');
  });
});

describe('buildPrompt', () => {
  const member: MemberConfig = { id: 'm1', name: '甲', adapter: 'claude', persona: '你是测试者', color: '#000' };
  const room: RoomConfig = {
    id: 'r', name: '测试房', topic: '测试主题', chainBudget: 6, speechLength: 'normal',
    toolPermission: 'readonly', members: [member], createdAt: 0,
  };

  it('包含角色、主题、聊天记录与长度指令', async () => {
    const history: ChatMessage[] = [{
      id: 'x', roomId: 'r', from: 'user', fromName: '用户', text: '你好', ts: 1,
    }];
    const p = await buildPrompt(room, member, history, { trigger: '轮到你了' });
    expect(p).toContain('你是测试者');
    expect(p).toContain('测试主题');
    expect(p).toContain('**[用户] (全员公聊)：**');
    expect(p).toContain('你好');
    expect(p).toContain('轮到你了');
    expect(p).toContain('600 字以内'); // normal 档
  });

  it('batonMode 注入接棒规则(chain/callout 两套文案,无则不注入)', async () => {
    const p0 = await buildPrompt(room, member, [], {});
    expect(p0).not.toContain('接棒规则');
    const pChain = await buildPrompt(room, member, [], { batonMode: 'chain' });
    expect(pChain).toContain('<接棒>@名字');
    expect(pChain).toContain('TA 会立即接着发言');
    const pCallout = await buildPrompt(room, member, [], { batonMode: 'callout' });
    expect(pCallout).toContain('<接棒>@名字');
    expect(pCallout).toContain('等用户发话后 TA 才开始');
  });

  it('short/long 长度档位', async () => {
    const short = await buildPrompt({ ...room, speechLength: 'short' }, member, [], {});
    expect(short).toContain('300 字以内');
    const long = await buildPrompt({ ...room, speechLength: 'long' }, member, [], {});
    expect(long).toContain('充分展开');
  });
});
