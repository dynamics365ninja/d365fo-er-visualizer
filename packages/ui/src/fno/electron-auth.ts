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

export class ElectronAuthProvider implements AuthProvider {
  async acquireToken(conn: FnoConnection): Promise<AuthResult> {
    const api = getElectronApi();
    if (!api?.fnoAuth) throw new FnoAuthError('Electron auth bridge not available');
    // Try silent first, fall back to interactive.
    try {
      const silent = await api.fnoAuth.silent(conn);
      if (silent && silent.accessToken && silent.expiresAt > Date.now() + 60_000) {
        return toAuthResult(silent);
      }
    } catch {
      // ignore — interactive fallback
    }
    try {
      const interactive = await api.fnoAuth.login(conn);
      return toAuthResult(interactive);
    } catch (err) {
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
