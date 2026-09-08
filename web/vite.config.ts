import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 类型共享:web 经 type-only import 引用 server 源码类型;
      // 唯一运行时例外:@server/protocolKeywords(根级零依赖纯常量叶子,协议标签真源——
      // 零 node 依赖,vite 打包与 vue-tsc 均安全)
      '@server': fileURLToPath(new URL('../server/src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3220', changeOrigin: true },
      '/ws': {
        target: 'ws://127.0.0.1:3220',
        ws: true,
      },
    },
  },
});
