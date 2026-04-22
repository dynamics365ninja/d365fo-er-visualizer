/**
 * Runtime factory picking the correct auth adapter based on host (Electron vs Browser).
 */

import type { AuthProvider } from '@er-visualizer/fno-client';
import { getElectronApi } from './electron-bridge';
import { ElectronAuthProvider } from './electron-auth';
import { BrowserAuthProvider } from './browser-auth';

let cached: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (cached) return cached;
  const api = getElectronApi();
  cached = api?.fnoAuth ? new ElectronAuthProvider() : new BrowserAuthProvider();
  return cached;
}
