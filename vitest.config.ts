/**
 * Vitest 配置（SYS-INFRA-009）。
 *
 * 与 vite.config.ts 完全分离，避免引入 uni-app / unocss / unplugin-* 一堆只服务于
 * 编译产物的插件 — 单测只需要 `@vitejs/plugin-vue` 跑 SFC、`@` 别名跟 src 对齐。
 *
 * 跑命令：
 *   pnpm test            # CI / 单次跑
 *   pnpm test:watch      # 开发期 watch 模式
 *   pnpm test:ui         # 浏览器 UI 报告（可选）
 */
import path from 'node:path'
import process from 'node:process'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,vue}'],
    exclude: ['node_modules', 'dist', 'dist/**'],
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.join(process.cwd(), './src'),
      '@img': path.join(process.cwd(), './src/static/images'),
    },
  },
})
