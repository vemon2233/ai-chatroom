// 主题流转(两态浅/深,localStorage 纯前端——主题无后端语义,不进 data/settings.json)。
// 模块级 theme ref 即唯一响应式真源(组件经 useTheme 消费共享 ref,严禁本地镜像)。
// 首画防闪由 web/index.html 内联脚本负责;initTheme 与其幂等(双保险),并同步 meta theme-color。

import { ref } from 'vue';

export type AppTheme = 'light' | 'dark';

const KEY = 'ai-chatroom:theme';

/** 两态 --bg 值,同步 <meta name="theme-color">(移动端浏览器 UI 条,桌面无感知) */
const META_COLORS: Record<AppTheme, string> = { light: '#F4F5F7', dark: '#0F1117' };

const theme = ref<AppTheme>('light');

function applySideEffects(t: AppTheme): void {
  document.documentElement.dataset.theme = t;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', META_COLORS[t]);
}

/** 启动初始化:localStorage 先行(与 index.html 内联脚本幂等),缺省浅色。 */
export function initTheme(): void {
  let t: AppTheme = 'light';
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') t = v;
  } catch {}
  theme.value = t;
  applySideEffects(t);
}

export function setTheme(t: AppTheme): void {
  theme.value = t;
  applySideEffects(t);
  try { localStorage.setItem(KEY, t); } catch {}
}

/** 组件消费:共享 ref(主题是文档级全局态,CSS 变量驱动,无本地副本) */
export function useTheme() {
  return { theme };
}
