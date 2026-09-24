// 协议关键字真源测试:双语并集解析 + 架构防线 tripwire(禁止内联回潮)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBaton, stripBatonLine } from '../src/core/modes/baton/baton';
import {
  splitPublicAndPrivateMessage, parseHandshake, parseAudience,
  inferHandshakeFromText,
} from '../src/core/modes/subscribe/audience';
import {
  BATON_LINE, BATON_END_WORDS, batonTagFor, USER_NAME_ALIASES, isSilentText,
  extractBatonTarget, extractImportance,
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
  it('stripBatonLine 双语剥除与指令正文共存测试', () => {
    expect(stripBatonLine('正文\n<接棒>@乙')).toBe('正文');
    expect(stripBatonLine('body\n<pass>@Bob')).toBe('body');
    // 用户指令行首并附带正文: 完整保留正文，不吞文本
    expect(stripBatonLine('<接棒> @刘备(于和伟) 接着奏乐接着舞')).toBe('接着奏乐接着舞');
    // 用户仅发指令而无附带正文: 回退保留 @名字，避免气泡空屏
    expect(stripBatonLine('<接棒> @刘备(于和伟)')).toBe('@刘备(于和伟)');
  });
  it('extractBatonTarget 能精准截断后续正文，不污染徽章名字', () => {
    expect(extractBatonTarget('<接棒> @刘备(于和伟) 接着奏乐接着舞')).toEqual({
      type: 'baton',
      target: '刘备(于和伟)',
    });
    expect(extractBatonTarget('<接棒> @刘备(于和伟)')).toEqual({
      type: 'baton',
      target: '刘备(于和伟)',
    });
    expect(extractBatonTarget('<接棒> 结束')).toEqual({ type: 'end' });
    expect(extractBatonTarget('<pass> @Bob let us dance')).toEqual({
      type: 'baton',
      target: 'Bob',
    });
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

describe('重要性前缀解析(! / !!)', () => {
  it('! = 2 档,!! = 3 档,净文本正确剥除', () => {
    expect(extractImportance('!重点内容')).toEqual({ importance: 2, text: '重点内容' });
    expect(extractImportance('!!每人只能说一句话')).toEqual({ importance: 3, text: '每人只能说一句话' });
    expect(extractImportance('!@玩家1 开始投票')).toEqual({ importance: 2, text: '@玩家1 开始投票' });
  });
  it('!!! 与裸前缀不解析(惊讶语气放行)', () => {
    expect(extractImportance('!!!太震惊了')).toBeNull();
    expect(extractImportance('!!!!更震惊')).toBeNull();
    expect(extractImportance('!!')).toBeNull();
    expect(extractImportance('!')).toBeNull();
  });
  it('!! 后紧跟正文才命中;第二个 ! 后跟 ! 被正确拒绝(防前缀吞噬)', () => {
    // !!规则 → 3 档;!!规则! 结尾感叹号不影响(锚定行首)
    expect(extractImportance('!!规则!')).toEqual({ importance: 3, text: '规则!' });
    expect(extractImportance('!规则!!')).toEqual({ importance: 2, text: '规则!!' });
  });
  it('前缀后跟空白不命中(裸感叹号 + 正文放行)', () => {
    expect(extractImportance('! 注意这里有空格')).toBeNull();
    expect(extractImportance('普通消息')).toBeNull();
    expect(extractImportance('')).toBeNull();
  });
  it('正文中间的感叹号不受影响(仅行首锚定)', () => {
    expect(extractImportance('好!太棒了!')).toBeNull();
    expect(extractImportance('多行\n!第二行前缀不解析(锚定首行)')).toBeNull();
    expect(extractImportance('!多行\n第二行保留')).toEqual({ importance: 2, text: '多行\n第二行保留' });
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

describe('私聊/握手双语并集解析', () => {
  const members = [
    { id: 'm1', name: '甲' }, { id: 'm2', name: '乙' }, { id: 'm3', name: 'Bob' },
  ];

  it('<dm>@Bob 拆出私聊块(与 <私聊>@乙 等价)', () => {
    const zh = splitPublicAndPrivateMessage('公开说一句\n<私聊>@乙 单独聊', members, 'm1');
    const en = splitPublicAndPrivateMessage('public words\n<dm>@Bob just between us', members, 'm1');
    expect(zh.privateBlocks[0]?.targetMemberIds).toEqual(['m2']);
    expect(en.privateBlocks[0]?.targetMemberIds).toEqual(['m3']);
    expect(en.publicText).toBe('public words');
    expect(en.privateBlocks[0]?.privateText).toBe('just between us');
  });
  it('<agree>/<decline> 握手标签解析', () => {
    expect(parseHandshake('成交\n<同意>', members)?.type).toBe('agree');
    expect(parseHandshake('deal\n<agree>', members)?.type).toBe('agree');
    expect(parseHandshake('no\n<decline>', members)?.type).toBe('reject');
    expect(parseHandshake('but\n<idea> @甲', members)).toEqual({ type: 'idea', targetMemberId: 'm1' });
  });
  it('英文语义兜底推断', () => {
    expect(inferHandshakeFromText('Deal.')).toBe('agree');
    expect(inferHandshakeFromText('Sure, count me in.')).toBe('agree');
    expect(inferHandshakeFromText('No way.')).toBe('reject');
    expect(inferHandshakeFromText('Absolutely not.')).toBe('reject');
    expect(inferHandshakeFromText('But my condition is…')).toBe('idea');
    expect(inferHandshakeFromText('However, I propose…')).toBe('idea');
  });
  it('中文语义兜底推断现状回归', () => {
    expect(inferHandshakeFromText('一言为定')).toBe('agree');
    expect(inferHandshakeFromText('不行,这绝对没得谈')).toBe('reject');
    expect(inferHandshakeFromText('不过我有不同想法')).toBe('idea');
  });
  it('英文清洗前缀(private:/public: 剥除)', () => {
    const r = splitPublicAndPrivateMessage('public: hi all\n<dm>@Bob private: secret', members, 'm1');
    expect(r.publicText).toBe('hi all');
    expect(r.privateBlocks[0]?.privateText).toBe('secret');
  });
  it('中文清洗前缀现状回归', () => {
    const r = splitPublicAndPrivateMessage('公开发言: 大家好\n<私聊>@乙 悄悄话: 别声张', members, 'm1');
    expect(r.publicText).toBe('大家好');
    expect(r.privateBlocks[0]?.privateText).toBe('别声张');
  });
  it('parseAudience <dm> 尾行解析', () => {
    expect(parseAudience('话说完\n<dm>@Bob', members, 'm1')).toEqual(['m3']);
    expect(parseAudience('话说完\n<私聊>@乙', members, 'm1')).toEqual(['m2']);
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
