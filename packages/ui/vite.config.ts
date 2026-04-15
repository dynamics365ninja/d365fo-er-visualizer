import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@er-visualizer/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('@xyflow/react')) {
            return 'xyflow';
          }

          if (id.includes('react-resizable-panels')) {
            return 'panels';
          }

          if (id.includes('react-dom') || id.includes(`${path.sep}react${path.sep}`)) {
            return 'react-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
});
