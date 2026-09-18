// AI 聊天室 v2 — 前端入口。

import { createApp } from 'vue';
import App from './App.vue';
import i18n, { initLang } from './i18n';
import { initTheme } from './composables/useTheme';
import './style.css';

createApp(App).use(i18n).mount('#app');
void initLang();
initTheme();
