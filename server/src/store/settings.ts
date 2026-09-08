// 全局设置持久化(data/settings.json):当前仅 lang。
// 复刻 rooms.ts 的原子写模式:temp + rename + EPERM 重试(Windows 杀毒占用)。
// 单 key 无读改写竞争,setLang 直接写——不走 rooms 的串行链。

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../paths';
import type { Lang } from '../core/i18n/lang';

const DEFAULT_FILE = path.join(REPO_ROOT, 'data', 'settings.json');

export interface SettingsStore {
  load(): Promise<void>;
  getLang(): Lang;
  setLang(lang: Lang): Promise<void>;
}

export function createSettingsStore(file = DEFAULT_FILE): SettingsStore {
  let lang: Lang = 'zh';

  async function atomicWrite(content: string): Promise<void> {
    const tmp = file + '.tmp';
    await writeFile(tmp, content, 'utf8');
    try {
      await rename(tmp, file);
    } catch (e: any) {
      if (e?.code === 'EPERM') {
        await new Promise((r) => setTimeout(r, 50));
        await rename(tmp, file); // 重试一次
        return;
      }
      throw e;
    }
  }

  return {
    async load() {
      if (!existsSync(file)) return;
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        if (parsed?.lang === 'en' || parsed?.lang === 'zh') lang = parsed.lang;
      } catch (e) {
        console.error('[settings-store] settings.json 损坏,回退默认:', e);
      }
    },
    getLang: () => lang,
    async setLang(next: Lang) {
      lang = next;
      await mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(JSON.stringify({ lang: next }, null, 2));
    },
  };
}

/** 进程单例(index.ts 启动时 load;routes/core 注入点共用) */
export const settings = createSettingsStore();
