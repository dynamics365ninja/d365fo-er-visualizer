import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VERCEL ? '/' : './',
  resolve: {
    alias: {
      '@er-visualizer/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@er-visualizer/fno-client': path.resolve(__dirname, '../fno-client/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
