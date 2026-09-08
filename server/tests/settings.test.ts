// settings 持久化测试:默认 zh、原子写、重载恢复、损坏回退。
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSettingsStore } from '../src/store/settings';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aichat-settings-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('settings store', () => {
  it('默认 zh(文件不存在)', async () => {
    const s = createSettingsStore(path.join(dir, 'settings.json'));
    await s.load();
    expect(s.getLang()).toBe('zh');
  });
  it('setLang 持久化且重载恢复', async () => {
    const file = path.join(dir, 'settings.json');
    const s = createSettingsStore(file);
    await s.load();
    await s.setLang('en');
    expect(s.getLang()).toBe('en');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lang: 'en' });
    const s2 = createSettingsStore(file);
    await s2.load();
    expect(s2.getLang()).toBe('en');
  });
  it('损坏文件回退 zh 不抛错', async () => {
    const file = path.join(dir, 'settings.json');
    writeFileSync(file, '{broken', 'utf8');
    const s = createSettingsStore(file);
    await s.load();
    expect(s.getLang()).toBe('zh');
  });
  it('非法 lang 值忽略(只认 zh/en)', async () => {
    const file = path.join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ lang: 'fr' }), 'utf8');
    const s = createSettingsStore(file);
    await s.load();
    expect(s.getLang()).toBe('zh');
  });
});
