// locale 流转:后端 settings 为权威(GET 校正),localStorage 为首屏缓存。
// setLang 即时生效:vue-i18n locale + <html lang> + <title> + PUT 后端(驱动系统消息与 prompt)。
import { createI18n } from 'vue-i18n';
import { zh } from './zh';
import { en } from './en';

export type AppLang = 'zh' | 'en';

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'zh',
  missingWarn: true,
  messages: { zh, en },
});

function applyLocaleSideEffects(lang: AppLang) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = i18n.global.t('app.title') as string;
}

/** 启动初始化:localStorage 先行(防闪屏),后端 GET 校正(权威)。 */
export async function initLang(): Promise<void> {
  let cached: AppLang | null = null;
  try {
    const v = localStorage.getItem('ai-chatroom:lang');
    if (v === 'zh' || v === 'en') cached = v;
  } catch {}
  let lang: AppLang = cached ?? (navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'zh');
  i18n.global.locale.value = lang;
  applyLocaleSideEffects(lang);
  try {
    // 直接 fetch(不经 api.ts——避免模块循环依赖)
    const r = await fetch('/api/settings');
    if (r.ok) {
      const j = await r.json();
      if (j.lang === 'zh' || j.lang === 'en') lang = j.lang;
    }
  } catch {}
  i18n.global.locale.value = lang;
  applyLocaleSideEffects(lang);
}

export function setLang(lang: AppLang): void {
  i18n.global.locale.value = lang;
  applyLocaleSideEffects(lang);
  try { localStorage.setItem('ai-chatroom:lang', lang); } catch {}
  void fetch('/api/settings/language', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  }).catch(() => {});
}

export function currentLang(): AppLang {
  return i18n.global.locale.value as AppLang;
}

/** 全局 t(非组件上下文用:api.ts/exportMarkdown.ts/markdown.ts 等) */
export const t = i18n.global.t;

export default i18n;
