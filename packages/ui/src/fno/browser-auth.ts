/**
 * Browser-side auth adapter wrapping MSAL Browser. Used when running the UI
 * as a plain SPA (not in Electron). Uses popup-first, falls back to redirect.
 */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';
import {
  buildAuthority,
  buildFnoScope,
  FnoAuthError,
  type AuthAccount,
  type AuthProvider,
  type AuthResult,
  type FnoConnection,
} from '@er-visualizer/fno-client';

const pool = new Map<string, PublicClientApplication>();

function appKey(conn: FnoConnection): string {
  return `${conn.tenantId}::${conn.clientId}`;
}

async function getOrCreate(conn: FnoConnection): Promise<PublicClientApplication> {
  const key = appKey(conn);
  const existing = pool.get(key);
  if (existing) return existing;
  const config: Configuration = {
    auth: {
      clientId: conn.clientId,
      authority: buildAuthority(conn.tenantId),
      redirectUri: window.location.origin,
      navigateToLoginRequestUrl: false,
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
  };
  const app = new PublicClientApplication(config);
  await app.initialize();
  pool.set(key, app);
  return app;
}

function resultToAuth(result: AuthenticationResult, envUrl: string): AuthResult {
  return {
    accessToken: result.accessToken,
    expiresAt: result.expiresOn ? result.expiresOn.getTime() : Date.now() + 55 * 60 * 1000,
    account: result.account ? accountToDomain(result.account) : undefined,
    envUrl,
  };
}

function accountToDomain(a: AccountInfo): AuthAccount {
  return {
    username: a.username,
    tenantId: a.tenantId,
    homeAccountId: a.homeAccountId,
    name: a.name,
  };
}

export class BrowserAuthProvider implements AuthProvider {
  async acquireToken(conn: FnoConnection): Promise<AuthResult> {
    const app = await getOrCreate(conn);
    const scopes = [buildFnoScope(conn)];
    const accounts = app.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const silent = await app.acquireTokenSilent({ account: accounts[0], scopes });
        return resultToAuth(silent, conn.envUrl);
      } catch (err) {
        if (!(err instanceof InteractionRequiredAuthError)) {
          // fall through to interactive
        }
      }
    }
    try {
      const popup = await app.acquireTokenPopup({ scopes, prompt: 'select_account' });
      return resultToAuth(popup, conn.envUrl);
    } catch (err) {
      throw new FnoAuthError('Sign-in failed', err);
    }
  }

  async signOut(conn: FnoConnection): Promise<void> {
    const app = await getOrCreate(conn);
    const accounts = app.getAllAccounts();
    for (const account of accounts) {
      await app.clearCache({ account });
    }
  }

  async getAccount(conn: FnoConnection): Promise<AuthAccount | null> {
    const app = await getOrCreate(conn);
    const accounts = app.getAllAccounts();
    return accounts.length > 0 ? accountToDomain(accounts[0]) : null;
  }
}
