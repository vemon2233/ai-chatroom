import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // export-markdown.test 跨包引用 web 源码——web 的两个别名在此镜像
      // (@server = server/src 根;@ = web/src 根)
      '@server': fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('../web/src', import.meta.url)),
    },
  },
  test: {
    // 纯核心域单测(fake adapter 注入,不 spawn 真实 CLI)
    include: ['tests/**/*.test.ts'],
  },
});
