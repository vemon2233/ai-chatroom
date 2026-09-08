import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { zh } from '../../web/src/i18n/zh';
import { en } from '../../web/src/i18n/en';

describe('Web vue-i18n 全量词典与插值真实渲染扫描', () => {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'zh',
    missingWarn: true,
    messages: { zh, en },
  });

  const dummyParams = {
    name: '张三',
    names: '张三、李四',
    next: '李四',
    origin: '用户指定',
    count: 3,
    n: 2,
    round: 1,
    rounds: 2,
    title: '三国演义',
    file: 'room.json',
    reason: '格式错误',
    action: '重roll',
    status: 404,
    key: 'claude',
    project: 'my-project',
    perm: '只读',
    list: '张三、李四',
    time: ' 12:00',
  };

  function extractKeys(obj: any, prefix = ''): string[] {
    let res: string[] = [];
    for (const k of Object.keys(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (typeof obj[k] === 'object' && obj[k] !== null) {
        res = res.concat(extractKeys(obj[k], full));
      } else if (typeof obj[k] === 'string') {
        res.push(full);
      }
    }
    return res;
  }

  const allKeys = extractKeys(zh);

  it('zh 词典全量 key 在 vue-i18n 实例下渲染无残留未插值占位符', () => {
    i18n.global.locale.value = 'zh';
    const failures: string[] = [];

    for (const key of allKeys) {
      const rendered = i18n.global.t(key, dummyParams) as string;
      const unescapedBrace = /\{[a-zA-Z0-9_]+\}/.exec(rendered);
      if (unescapedBrace) {
        failures.push(`${key} -> "${rendered}" (未解析占位符: ${unescapedBrace[0]})`);
      }
    }

    expect(failures, `发现存在未正确插值的中文词条:\n${failures.join('\n')}`).toEqual([]);
  });

  it('en 词典全量 key 在 vue-i18n 实例下渲染无残留未插值占位符', () => {
    i18n.global.locale.value = 'en';
    const failures: string[] = [];

    for (const key of allKeys) {
      const rendered = i18n.global.t(key, dummyParams) as string;
      const unescapedBrace = /\{[a-zA-Z0-9_]+\}/.exec(rendered);
      if (unescapedBrace) {
        failures.push(`${key} -> "${rendered}" (未解析占位符: ${unescapedBrace[0]})`);
      }
    }

    expect(failures, `发现存在未正确插值的英文词条:\n${failures.join('\n')}`).toEqual([]);
  });

  it('检查 batonPass 真实渲染结果正确包含 @ 与传入名字', () => {
    i18n.global.locale.value = 'zh';
    expect(i18n.global.t('chat.batonPass', { name: '曹操' })).toBe('🎯 接棒 @曹操');

    i18n.global.locale.value = 'en';
    expect(i18n.global.t('chat.batonPass', { name: 'Alice' })).toBe('🎯 Baton @Alice');
  });

  it('检查 batonGive 真实渲染结果正确包含 @ 与传入名字', () => {
    i18n.global.locale.value = 'zh';
    expect(i18n.global.t('export.batonGive', { name: '曹操' })).toBe('🎯 接棒给 @曹操');

    i18n.global.locale.value = 'en';
    expect(i18n.global.t('export.batonGive', { name: 'Alice' })).toBe('🎯 baton to @Alice');
  });

  it('chipHint 含有管道符 | 时不应被 vue-i18n 切割成复数分支', () => {
    i18n.global.locale.value = 'zh';
    const r = i18n.global.t('chat.chipHint', { persona: '丞相' });
    console.log('chipHint rendered:', r);
    expect(r).toBe('丞相\n点击下指令 | ✕ 移出房间');
  });
});
