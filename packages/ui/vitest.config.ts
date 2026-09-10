import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Same aliases as vite.config.ts: the app compiles the sibling packages from
  // source, so the tests must not run against a stale dist build.
  resolve: {
    alias: {
      '@er-visualizer/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@er-visualizer/fno-client': path.resolve(__dirname, '../fno-client/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
