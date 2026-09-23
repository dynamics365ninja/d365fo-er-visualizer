import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Content-Security-Policy for built output. index.html carries the dev policy
 * (inline scripts for React Refresh, `ws:` + localhost:5173 for HMR); a build
 * swaps in this one. It is the policy that actually applies in the packaged
 * Electron shell, which loads over file:// where the main process' response
 * header hook never fires, and in the web deployment under /app.
 *
 * No inline or remote script, no dev-server origins. connect-src keeps the
 * Entra endpoints MSAL talks to and the F&O host families; the web app reaches
 * F&O through the same-origin /api/fno proxy and Electron through IPC, so the
 * F&O entries are defence in depth rather than a requirement.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // The boot `<style>` in index.html and runtime style attributes (React Flow,
  // Fluent) need inline styles.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://login.microsoftonline.com https://login.microsoft.com https://login.windows.net " +
    'https://*.operations.dynamics.com https://*.cloudax.dynamics.com https://*.axcloud.dynamics.com https://*.sandbox.ax.dynamics.com',
  "frame-src 'self' https://login.microsoftonline.com https://login.microsoft.com",
  "form-action 'self' https://login.microsoftonline.com",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ') + ';';

const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/i;

function productionCsp(): Plugin {
  return {
    name: 'er-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!CSP_META.test(html)) {
        // Fail loudly: shipping without a CSP must not happen silently.
        throw new Error('er-production-csp: no Content-Security-Policy <meta> found in index.html');
      }
      return html.replace(CSP_META, (_m, open: string, close: string) => `${open}${PRODUCTION_CSP}${close}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), productionCsp()],
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
    // A launcher that assigns the port passes it as PORT; take exactly that one,
    // since it probes the port it handed out. Without PORT, Vite keeps its 5173
    // default, which is the redirect URI Entra has registered for F&O sign-in.
    // An explicit `--port` (the Electron dev script) still wins over both.
    ...(process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {}),
    // The browser F&O transport posts to /api/fno, which is served by the Next
    // marketing site (packages/site/app/api/fno/route.ts). In `pnpm dev` forward
    // it there so the web F&O flow works locally — run `pnpm dev:site` alongside,
    // or point FNO_DEV_PROXY_TARGET at a deployed instance.
    proxy: {
      '/api/fno': {
        target: process.env.FNO_DEV_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        // The proxy refuses callers whose Origin is not its own. The browser
        // sees this call as same-origin (the Vite server), so present it to
        // the target as such rather than as a foreign localhost:5173 origin.
        configure: proxy => {
          const targetOrigin = new URL(process.env.FNO_DEV_PROXY_TARGET ?? 'http://localhost:3000').origin;
          proxy.on('proxyReq', proxyReq => {
            if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', targetOrigin);
          });
        },
      },
    },
    watch: {
      // Watch sibling workspace packages so HMR fires when er-services.ts etc. change.
      // Test files are never part of the app, yet editing one reached the dev
      // server and reloaded the page, dropping every loaded configuration.
      // Vitest reads vitest.config.ts, so its own watch mode still sees them.
      ignored: (p: string) => TEST_FILE.test(p) || (p.includes('node_modules') && !p.includes('@er-visualizer')),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
