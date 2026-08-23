import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative by default so the Electron shell can load the build over file://.
  // The web deployment stages the SPA under /app on the marketing site and
  // sets APP_BASE=/app/ so assets resolve from any URL under that path.
  base: process.env.APP_BASE ?? './',
  resolve: {
    alias: {
      '@er-visualizer/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@er-visualizer/fno-client': path.resolve(__dirname, '../fno-client/src/index.ts'),
    },
  },
  server: {
    // The browser F&O transport posts to /api/fno, which is served by the Next
    // marketing site (packages/site/app/api/fno/route.ts). In `pnpm dev` forward
    // it there so the web F&O flow works locally — run `pnpm dev:site` alongside,
    // or point FNO_DEV_PROXY_TARGET at a deployed instance.
    proxy: {
      '/api/fno': {
        target: process.env.FNO_DEV_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    watch: {
      // Watch sibling workspace packages so HMR fires when er-services.ts etc. change.
      ignored: (p: string) => p.includes('node_modules') && !p.includes('@er-visualizer'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
