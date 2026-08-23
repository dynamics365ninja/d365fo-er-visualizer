/**
 * AuthProvider implementation that delegates to the Electron main process
 * via the `window.electronAPI.fnoAuth` IPC surface.
 */

import {
  FnoAuthError,
  type AuthAccount,
  type AuthProvider,
  type AuthResult,
  type FnoConnection,
} from '@er-visualizer/fno-client';
import { getElectronApi } from './electron-bridge';

/**
 * IPC cannot carry an AbortSignal, so the main process applies its own login
 * timeout. On the renderer side we at least stop waiting when the caller
 * aborts: the IPC promise is raced against the signal.
 */
function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  const abortError = () =>
    new FnoAuthError(signal.reason instanceof Error ? signal.reason.message : 'Sign-in aborted');
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export class ElectronAuthProvider implements AuthProvider {
  async acquireToken(conn: FnoConnection, signal?: AbortSignal): Promise<AuthResult> {
    const api = getElectronApi();
    if (!api?.fnoAuth) throw new FnoAuthError('Electron auth bridge not available');
    // Try silent first, fall back to interactive.
    try {
      const silent = await raceWithSignal(api.fnoAuth.silent(conn), signal);
      if (silent && silent.accessToken && silent.expiresAt > Date.now() + 60_000) {
        return toAuthResult(silent);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      // otherwise ignore — interactive fallback
    }
    try {
      const interactive = await raceWithSignal(api.fnoAuth.login(conn), signal);
      return toAuthResult(interactive);
    } catch (err) {
      if (err instanceof FnoAuthError) throw err;
      const msg = err instanceof Error && err.message ? err.message : 'Sign-in failed';
      throw new FnoAuthError(msg, err);
    }
  }

  async signOut(conn: FnoConnection): Promise<void> {
    const api = getElectronApi();
    if (!api?.fnoAuth) return;
    await api.fnoAuth.logout(conn);
  }

  async getAccount(conn: FnoConnection): Promise<AuthAccount | null> {
    const api = getElectronApi();
    if (!api?.fnoAuth) return null;
    const res = await api.fnoAuth.account(conn);
    if (!res) return null;
    return {
      username: res.username,
      tenantId: res.tenantId,
      homeAccountId: res.homeAccountId,
      name: res.name,
    };
  }
}

function toAuthResult(r: {
  accessToken: string;
  expiresAt: number;
  envUrl: string;
  account: { username: string; tenantId: string; homeAccountId?: string; name?: string } | null;
}): AuthResult {
  return {
    accessToken: r.accessToken,
    expiresAt: r.expiresAt,
    envUrl: r.envUrl,
    account: r.account ? {
      username: r.account.username,
      tenantId: r.account.tenantId,
      homeAccountId: r.account.homeAccountId,
      name: r.account.name,
    } : undefined,
  };
}
