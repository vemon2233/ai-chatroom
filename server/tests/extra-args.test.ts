// extraArgs 白名单测试(ADR-0002):单一校验函数 filterExtraArgs 的纯函数行为 +
// 入口接线行为(角色创建 400 / 导入剥离 / makeRoomConfig 收口)。
// 防注入背景:extraArgs 未过滤前可夹带 --dangerously-bypass 绕过权限档位。

import { describe, it, expect } from 'vitest';
import { filterExtraArgs } from '../src/core/extraArgs';
import { makeRoomConfig } from '../src/core/room';

describe('filterExtraArgs 纯函数', () => {
  it('白名单通过:--model <v> 与 --thinking-budget <n>(双 token 形)', () => {
    expect(filterExtraArgs(['--model', 'sonnet', '--thinking-budget', '8000'])).toEqual({
      args: ['--model', 'sonnet', '--thinking-budget', '8000'],
      removed: [],
    });
  });

  it('白名单通过:= 连写形归一为双 token', () => {
    expect(filterExtraArgs(['--model=haiku', '--thinking-budget=2048']).args)
      .toEqual(['--model', 'haiku', '--thinking-budget', '2048']);
  });

  it('危险参数被剥离:--dangerously-bypass 类不进 args', () => {
    const r = filterExtraArgs(['--model', 'sonnet', '--dangerously-bypass-approvals-and-sandbox']);
    expect(r.args).toEqual(['--model', 'sonnet']);
    expect(r.removed).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('--allowedTools 注入企图被剥离', () => {
    const r = filterExtraArgs(['--allowedTools', 'Bash']);
    expect(r.args).toEqual([]);
    expect(r.removed).toEqual(['--allowedTools', '<positional:Bash>']);
  });

  it('model 值非法(空/下一项是 flag)时整体剥离', () => {
    expect(filterExtraArgs(['--model']).args).toEqual([]);
    expect(filterExtraArgs(['--model', '--verbose']).args).toEqual([]);
    expect(filterExtraArgs(['--model=']).args).toEqual([]);
  });

  it('thinking-budget 值非正整数时剥离', () => {
    expect(filterExtraArgs(['--thinking-budget', 'abc']).args).toEqual([]);
    expect(filterExtraArgs(['--thinking-budget', '-5']).args).toEqual([]);
    expect(filterExtraArgs(['--thinking-budget', '0']).args).toEqual([]);
    expect(filterExtraArgs(['--thinking-budget', '8000']).args).toEqual(['--thinking-budget', '8000']);
  });

  it('非数组输入返回空', () => {
    expect(filterExtraArgs(undefined)).toEqual({ args: [], removed: [] });
    expect(filterExtraArgs('not-array')).toEqual({ args: [], removed: [] });
    expect(filterExtraArgs(null)).toEqual({ args: [], removed: [] });
  });

  it('非字符串元素剥离并留痕', () => {
    const r = filterExtraArgs([123, '--model', 'x'] as unknown[]);
    expect(r.args).toEqual(['--model', 'x']);
    expect(r.removed).toContain('<non-string:123>');
  });

  it('孤立的未知 flag 与位置参数都剥离', () => {
    const r = filterExtraArgs(['--verbose', 'bare-positional']);
    expect(r.args).toEqual([]);
    expect(r.removed).toEqual(['--verbose', '<positional:bare-positional>']);
  });
});

describe('makeRoomConfig 入口收口(建房+房间导入共用)', () => {
  it('成员 extraArgs 经白名单过滤,危险参数不落 config', () => {
    const cfg = makeRoomConfig({
      name: 't',
      topic: 'x',
      members: [{
        name: 'm1',
        adapter: 'claude',
        persona: 'p',
        color: '#fff',
        extraArgs: ['--model', 'haiku', '--dangerously-bypass-approvals-and-sandbox'],
      }],
    });
    expect(cfg.members[0]!.extraArgs).toEqual(['--model', 'haiku']);
  });

  it('全剥离后 extraArgs 置 undefined(不留空数组)', () => {
    const cfg = makeRoomConfig({
      name: 't',
      topic: 'x',
      members: [{
        name: 'm1', adapter: 'claude', persona: 'p', color: '#fff',
        extraArgs: ['--dangerously-bypass'],
      }],
    });
    expect(cfg.members[0]!.extraArgs).toBeUndefined();
  });
});
