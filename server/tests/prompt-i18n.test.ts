// prompt 双语测试:zh 逐字节现状锁 + en 词典与标签真源注入。
import { describe, it, expect } from 'vitest';
import { buildBatonPromptSection } from '../src/core/modes/baton/prompt';
import { buildSubscribePromptSection } from '../src/core/modes/subscribe/prompt';
import { buildScoutPrompt } from '../src/core/prompt';
import { historyText, lengthBrief, permissionBrief } from '../src/core/render';
import type { MemberConfig, ChatMessage } from '../src/core/types';

const member: MemberConfig = { id: 'm1', name: '甲', adapter: 'fake', persona: 'p', color: '#000' };
const members: MemberConfig[] = [
  member,
  { id: 'm2', name: '乙', adapter: 'fake', persona: 'p', color: '#000' },
];

const msgs: ChatMessage[] = [
  { id: '1', roomId: 'r', from: 'm2', fromName: '乙', text: 'hey @甲 what do you think', ts: 0 },
  { id: '2', roomId: 'r', from: 'm1', fromName: '甲', text: 'secret', ts: 1, audience: ['m2'] },
];

describe('prompt 双语', () => {
  it('baton 段:zh 教 <接棒>(逐字节现状),en 教 <pass>', () => {
    const zh = buildBatonPromptSection(member, members, 'chain', 'zh');
    expect(zh).toContain('**<接棒>@名字**');
    expect(zh).toContain('# 接棒规则 (重要)');
    const en = buildBatonPromptSection(member, members, 'chain', 'en');
    expect(en).toContain('**<pass>@name**');
    expect(en).toContain('# Baton Rules (Important)');
    expect(en).not.toContain('<接棒>');
  });
  it('缺省 lang=zh:与现状一致(既有调用兼容)', () => {
    expect(buildBatonPromptSection(member, members, 'chain')).toContain('<接棒>');
  });
  it('subscribe 段:en 禁 <pass> 指令 + <skip> 出口 + <dm> 教学', () => {
    const en = buildSubscribePromptSection(member, members, { mustRespond: true }, 'en');
    expect(en).toContain('<dm>');
    expect(en).toContain('<skip>');
    expect(en).toContain('<silent>');
    expect(en).not.toContain('<跳过>');
    const zh = buildSubscribePromptSection(member, members, { mustRespond: true }, 'zh');
    expect(zh).toContain('<跳过>');
    expect(zh).toContain('<沉默>');
  });
  it('subscribe 自动段双语', () => {
    const en = buildSubscribePromptSection(member, members, {}, 'en');
    expect(en).toContain('Autonomous Group Chat');
    expect(en).toContain('colleagues'); // whitelist JSON key 英文化
  });
  it('historyText:en 标签 + 提及高亮', () => {
    // viewer = 甲(m1):公聊里被 @提及 + 自己发出的私聊密信
    expect(historyText(msgs, 10, 'm1', '甲', 'en')).toContain('(public to all)');
    expect(historyText(msgs, 10, 'm1', '甲', 'en')).toContain('@mentioned you');
    expect(historyText(msgs, 10, 'm1', '甲', 'zh')).toContain('【@提及了你】');
    expect(historyText(msgs, 10, 'm1', '甲', 'zh')).toContain('【私聊密信 ── 你 发送给对方】：');
  });
  it('lengthBrief/permissionBrief 双语', () => {
    expect(lengthBrief('short', 'zh')).toContain('300 字');
    expect(lengthBrief('short', 'en')).toContain('300 words');
    expect(permissionBrief('readonly', 'zh')).toContain('不能修改任何文件');
    expect(permissionBrief('readonly', 'en')).toContain('must not modify');
  });
  it('buildScoutPrompt 双语', () => {
    expect(buildScoutPrompt('/x', 'tree', 'en')).toContain('project scout');
    expect(buildScoutPrompt('/x', 'tree')).toContain('项目侦察员');
  });
});

// ---------- 用户重要性分档转录(!/!! 前缀) ----------

import { pinVital } from '../src/core/render';

describe('historyText 用户重要性分档', () => {
  const userMsg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'u1', roomId: 'r', from: 'user', fromName: '用户', text: '每人只能说一句话', ts: 0, ...over,
  });

  it('2 档 → 【用户重点】;3 档 → 【用户最高指令】+ 冲突优先尾注(zh)', () => {
    const zh2 = historyText([userMsg({ importance: 2 })], 10, 'm1', '甲', 'zh');
    expect(zh2).toContain('【用户重点】[用户]');
    expect(zh2).not.toContain('用户最高指令');

    const zh3 = historyText([userMsg({ importance: 3 })], 10, 'm1', '甲', 'zh');
    expect(zh3).toContain('【用户最高指令 ── 必须遵守】[用户]');
    expect(zh3).toContain('以此条为准并严格执行');
  });
  it('en 档位标签', () => {
    expect(historyText([userMsg({ importance: 2 })], 10, 'm1', '甲', 'en')).toContain('[User emphasized]');
    expect(historyText([userMsg({ importance: 3 })], 10, 'm1', '甲', 'en')).toContain("USER'S HARD RULE");
  });
  it('无 importance / 1 档走普通公聊格式(无强调)', () => {
    const out = historyText([userMsg({ importance: 1 })], 10, 'm1', '甲', 'zh');
    expect(out).toContain('[用户] (全员公聊)');
    expect(out).not.toContain('用户重点');
    expect(out).not.toContain('用户最高指令');
  });
  it('档位优先于 @提及判定(规则比点名更硬)', () => {
    const out = historyText([userMsg({ importance: 3, text: '遵守规则 @甲' })], 10, 'm1', '甲', 'zh');
    expect(out).toContain('用户最高指令');
    expect(out).not.toContain('【@提及了你】');
  });
  it('3 档豁免 recent 截断(窗口外的规则前置回插)', () => {
    const msgs: ChatMessage[] = [
      userMsg({ id: 'rule', importance: 3 }),
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `fill_${i}`, roomId: 'r', from: 'm2', fromName: '乙', text: `填充${i}`, ts: i + 1,
      })),
    ];
    const out = historyText(msgs, 5, 'm1', '甲', 'zh');
    expect(out).toContain('用户最高指令');   // 规则被 pin 回
    expect(out).toContain('填充11');         // 窗口内最新消息仍在
    expect(out.indexOf('用户最高指令')).toBeLessThan(out.indexOf('填充11')); // 时序前置
  });
});

describe('pinVital 纯函数', () => {
  const rule = (id: string): ChatMessage => ({
    id, roomId: 'r', from: 'user', fromName: '用户', text: `规则${id}`, ts: 1, importance: 3,
  });
  const plain = (id: string): ChatMessage => ({
    id, roomId: 'r', from: 'user', fromName: '用户', text: id, ts: 1,
  });

  it('遗漏的 3 档公聊消息前置;2 档/私聊/已在窗口内的不 pin', () => {
    const source = [
      rule('r1'),
      plain('p1'),
      { ...rule('r2'), audience: ['m2'] as string[] }, // 私聊形式的 3 档不 pin(公聊语义)
    ];
    const win = [plain('p1')];
    const out = pinVital(source, win);
    expect(out.map((m) => m.id)).toEqual(['r1', 'p1']);
  });
  it('窗口已含该规则(同一引用)不重复', () => {
    const r = rule('r1');
    expect(pinVital([r, plain('p1')], [r, plain('p1')]).map((m) => m.id)).toEqual(['r1', 'p1']);
  });
  it('无遗漏时返回窗口浅拷贝(不原地改)', () => {
    const win = [plain('p1')];
    const out = pinVital([plain('p1')], win);
    expect(out).toEqual(win);
    expect(out).not.toBe(win);
  });
});

// ---------- 纪要/摘要 prompt 双语 ----------

import { buildPrivateDigestPrompt } from '../src/core/summaryOps';

describe('私聊纪要/摘要 prompt 双语', () => {
  const digestMsgs = [
    { id: '1', roomId: 'r', from: 'm1', fromName: '甲', text: 'x', ts: 0, audience: ['m2'] },
  ] as any[];
  it('zh 逐字节现状', () => {
    const p = buildPrivateDigestPrompt(member, digestMsgs, null, 'zh');
    expect(p).toContain('私聊密信往来');
    expect(p).toContain('【输出要求】');
    expect(p).toContain('500 字以内');
  });
  it('en 翻译', () => {
    const p = buildPrivateDigestPrompt(member, digestMsgs, null, 'en');
    expect(p).toContain('private DM exchanges');
    expect(p).toContain('500 words');
  });
});
