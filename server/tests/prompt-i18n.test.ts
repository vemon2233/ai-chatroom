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
