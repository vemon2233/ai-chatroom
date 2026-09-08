// 协议关键字真源测试:双语并集解析 + 架构防线 tripwire(禁止内联回潮)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBaton, stripBatonLine } from '../src/core/modes/baton/baton';
import {
  BATON_LINE, BATON_END_WORDS, batonTagFor, USER_NAME_ALIASES, isSilentText,
} from '../src/protocolKeywords';

const members = [
  { id: 'm1', name: '甲' },
  { id: 'm2', name: '乙' },
  { id: 'm3', name: 'Bob' },
];

describe('协议标签双语并集解析', () => {
  it('<pass>@Bob 与 <接棒>@乙 等价解析到成员', () => {
    expect(parseBaton('第一棒\n<接棒>@乙', members, 'm1')?.nextMemberId).toBe('m2');
    expect(parseBaton('first\n<pass>@Bob', members, 'm1')?.nextMemberId).toBe('m3');
    expect(parseBaton('first\n<PASS>@Bob', members, 'm1')?.nextMemberId).toBe('m3');
  });
  it('<pass>end 触发结束;词边界防误触(recommend 不触发)', () => {
    expect(parseBaton('done\n<pass>end', members, 'm1')?.endDiscussion).toBe(true);
    expect(parseBaton('done\n<pass>end the debate', members, 'm1')?.endDiscussion).toBe(true);
    expect(parseBaton('done\n<pass>recommend Sarah', members, 'm1')?.endDiscussion).toBeFalsy();
  });
  it('<pass>user 交还用户(与 <接棒>用户 同义)', () => {
    expect(parseBaton('over to you\n<pass>user', members, 'm1')?.toUser).toBe(true);
    expect(parseBaton('交给你\n<接棒>用户', members, 'm1')?.toUser).toBe(true);
  });
  it('stripBatonLine 双语剥除', () => {
    expect(stripBatonLine('正文\n<接棒>@乙')).toBe('正文');
    expect(stripBatonLine('body\n<pass>@Bob')).toBe('body');
  });
  it('BATON_LINE 不误配正文普通尖括号', () => {
    expect('see <code>blocks</code> often'.match(BATON_LINE)).toBeNull();
  });
  it('BATON_END_WORDS 中文词仍命中(现状回归)', () => {
    expect(BATON_END_WORDS.test('结束')).toBe(true);
    expect(BATON_END_WORDS.test('收敛')).toBe(true);
  });
});

describe('batonTagFor 按语言发射', () => {
  it('zh → <接棒>,en → <pass>', () => {
    expect(batonTagFor('zh')).toBe('<接棒>');
    expect(batonTagFor('en')).toBe('<pass>');
  });
});

describe('沉默/跳过双语判定', () => {
  it.each(['<跳过>', '【跳过】', '跳过', '<skip>', '<silent>', 'silent', 'Skip'])(
    '%s 判为沉默', (s) => expect(isSilentText(s)).toBe(true),
  );
  it('正文发言不误判', () => {
    expect(isSilentText('我认为这个方案有问题,理由如下…')).toBe(false);
    expect(isSilentText('I disagree with this approach.')).toBe(false);
  });
  it('空与 undefined 判为沉默(现状语义)', () => {
    expect(isSilentText('')).toBe(true);
    expect(isSilentText(undefined)).toBe(true);
  });
  it('标签后跟说明的前缀容错', () => {
    expect(isSilentText('<skip> 本轮不发言')).toBe(true);
    expect(isSilentText('<跳过> 保持观望')).toBe(true);
  });
});

describe('架构防线:协议正则不内联(单一真源 tripwire)', () => {
  const SRC = path.resolve(__dirname, '../src');
  const consumers = [
    'core/modes/baton/baton.ts',
    'core/modes/subscribe/audience.ts',
    'core/orchestrator.ts',
    'store/trace.ts',
  ];
  it.each(consumers)('%s 引用 protocolKeywords 真源', (rel) => {
    const src = readFileSync(path.join(SRC, rel), 'utf8');
    expect(src, `${rel} 必须从 protocolKeywords 引入常量`).toContain('protocolKeywords');
  });
});

describe('USER_NAME_ALIASES', () => {
  it('现状双语', () => {
    expect(USER_NAME_ALIASES).toContain('用户');
    expect(USER_NAME_ALIASES).toContain('user');
  });
});
