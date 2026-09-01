import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 纯核心域单测(fake adapter 注入,不 spawn 真实 CLI)
    include: ['tests/**/*.test.ts'],
  },
});
