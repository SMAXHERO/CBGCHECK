import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/utils/__tests__/**/*.test.ts', 'src/components/__tests__/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: [
        'src/utils/predicate.ts',
        'src/utils/params.ts',
        'src/utils/analytics.ts',
        'src/utils/format.ts',
        'src/utils/sort.ts',
        'src/utils/columns.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        branches: 70,
      },
    },
  },
});
