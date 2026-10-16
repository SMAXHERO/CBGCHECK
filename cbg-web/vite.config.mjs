import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages 项目页会部署在 https://<user>.github.io/<repo>/ 子路径下。
// 用相对 base（'./'）可以让产物同时适配「仓库根页」和「项目子路径页」，
// 也兼容本地 `vite preview`，不需要每次改配置。
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          antd: ['antd', '@ant-design/icons'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    watch: {
      // 有些编辑器/工具用「临时目录 + 原子替换」的方式存盘，会在源码目录里
      // 短暂生成 .xxx.tmpdir/ 和 *.tmp。chokidar 去 watch 这些转瞬即逝的路径
      // 会抛 EBUSY 并直接搞崩 dev 进程，所以显式忽略掉。
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.tmp/**', '**/node_modules/**', '**/dist/**'],
    },
  },
});
