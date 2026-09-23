/**
 * Runtime factory picking the correct auth adapter based on host (Electron vs Browser).
 */

import { FnoAuthError, type AuthProvider } from '@er-visualizer/fno-client';
import { getElectronApi } from './electron-bridge';
import { t } from '../i18n';

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
 * Load an auth adapter chunk, turning a chunk-load failure into something
 * actionable. The raw browser message ("Failed to fetch dynamically imported
 * module: …/browser-auth.ts") says nothing about the actual cause, which is
 * always the same: the code could not be downloaded — dev server stopped, the
 * page is running against a redeployed build whose hashed chunks are gone, or
 * the network dropped. All three are fixed by reloading the page.
 */
async function loadAdapter<T>(load: () => Promise<T>, moduleName: string): Promise<T> {
  try {
    return await load();
  } catch (err) {
    throw new FnoAuthError(
      t.fnoAuthModuleLoadFailed(moduleName),
      err,
    );
  }
}

/**
 * Async so the adapters — and with them MSAL, ~0.4 MB of the bundle — load only
 * when someone actually signs in to F&O. Opening an XML file from disk should
 * not pay for an identity library.
 */
export async function getAuthProvider(): Promise<AuthProvider> {
  if (cached) return cached;
  const api = getElectronApi();
  if (api?.fnoAuth) {
    const { ElectronAuthProvider } = await loadAdapter(() => import('./electron-auth'), 'electron-auth');
    cached = new ElectronAuthProvider();
    return cached;
  }
  if (isOwnElectronShell()) {
    // Our shell, but preload didn't expose the bridge — refuse to silently fall
    // back to the browser flow, whose popup the Electron window blocker kills
    // with popup_window_error.
    throw new FnoAuthError(
      t.fnoAuthElectronBridgeMissing,
    );
  }
  const { BrowserAuthProvider } = await loadAdapter(() => import('./browser-auth'), 'browser-auth');
  cached = new BrowserAuthProvider();
  return cached;
}
