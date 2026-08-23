/**
 * Runtime factory picking the correct auth adapter based on host (Electron vs Browser).
 */

import { FnoAuthError, type AuthProvider } from '@er-visualizer/fno-client';
import { getElectronApi } from './electron-bridge';
import { locale } from '../i18n';

/**
 * True only inside the ER Visualizer Electron shell, which stamps its own token
 * into the user agent (see packages/electron/src/main.ts).
 *
 * Do NOT go back to matching /Electron/ in the user agent: every Electron-based
 * browser (VS Code's Simple Browser, Claude's browser pane, Slack's, …) matches
 * it too, and those run the plain web build where the popup sign-in works fine —
 * they were being refused with "auth bridge unavailable".
 */
function isOwnElectronShell(): boolean {
  if (typeof navigator !== 'undefined' && /ERVisualizerShell\//.test(navigator.userAgent)) return true;
  // Older shell builds predate the UA token; the exposed bridge identifies them.
  return getElectronApi() != null;
}

let cached: AuthProvider | null = null;

/**
 * Async so the adapters — and with them MSAL, ~0.4 MB of the bundle — load only
 * when someone actually signs in to F&O. Opening an XML file from disk should
 * not pay for an identity library.
 */
export async function getAuthProvider(): Promise<AuthProvider> {
  if (cached) return cached;
  const api = getElectronApi();
  if (api?.fnoAuth) {
    const { ElectronAuthProvider } = await import('./electron-auth');
    cached = new ElectronAuthProvider();
    return cached;
  }
  if (isOwnElectronShell()) {
    // Our shell, but preload didn't expose the bridge — refuse to silently fall
    // back to the browser flow, whose popup the Electron window blocker kills
    // with popup_window_error.
    throw new FnoAuthError(
      locale === 'cs'
        ? 'Electron auth bridge není k dispozici — preload se nenačetl, takže window.electronAPI chybí. ' +
          'Podívej se do konzole hlavního procesu na "[electron] preload failed to load"; ' +
          'nejčastější příčinou je preload zkompilovaný jako ESM (balíček má "type": "module", ' +
          'sandboxovaný preload musí být CommonJS → dist/preload.cjs). ' +
          'Přebuilduj přes `pnpm --filter @er-visualizer/electron build` a restartuj aplikaci.'
        : 'Electron auth bridge is unavailable — the preload script did not load, so window.electronAPI is missing. ' +
          'Check the main-process console for "[electron] preload failed to load"; ' +
          'the usual cause is a preload compiled as ESM (the package has "type": "module", ' +
          'a sandboxed preload must be CommonJS → dist/preload.cjs). ' +
          'Rebuild with `pnpm --filter @er-visualizer/electron build` and restart the application.',
    );
  }
  const { BrowserAuthProvider } = await import('./browser-auth');
  cached = new BrowserAuthProvider();
  return cached;
}
