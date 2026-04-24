/**
 * Runtime factory picking the correct auth adapter based on host (Electron vs Browser).
 */

import { FnoAuthError, type AuthProvider } from '@er-visualizer/fno-client';
import { getElectronApi } from './electron-bridge';
import { ElectronAuthProvider } from './electron-auth';
import { BrowserAuthProvider } from './browser-auth';

function isElectronRuntime(): boolean {
  if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) return true;
  const proc = (globalThis as { process?: { versions?: { electron?: string } } }).process;
  if (proc?.versions?.electron) return true;
  return false;
}

let cached: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (cached) return cached;
  const api = getElectronApi();
  if (isElectronRuntime()) {
    if (!api?.fnoAuth) {
      // Running in Electron but preload didn't expose the bridge — refuse to
      // silently fall back to the browser flow (which would try to open a
      // popup that the Electron window blocker kills with popup_window_error).
      throw new FnoAuthError(
        'Electron auth bridge není k dispozici. Zkontroluj, že preload.js je správně načten (packages/electron/dist/preload.js) a přebuilduj Electron (`pnpm --filter @er-visualizer/electron build`) a restartuj aplikaci.',
      );
    }
    cached = new ElectronAuthProvider();
    return cached;
  }
  cached = api?.fnoAuth ? new ElectronAuthProvider() : new BrowserAuthProvider();
  return cached;
}
