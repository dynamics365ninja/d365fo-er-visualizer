/**
 * Browser-side auth adapter wrapping MSAL Browser. Used when running the UI
 * as a plain SPA (not in Electron). Popup first, redirect as a fallback.
 */

import {
  PublicClientApplication,
  BrowserAuthError,
  LogLevel,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';
import {
  authContextKey,
  buildAuthority,
  buildFnoScope,
  resolveClientId,
  FnoAuthError,
  type AuthAccount,
  type AuthProvider,
  type AuthResult,
  type FnoConnection,
} from '@er-visualizer/fno-client';
import { clearRedirectPending, computeRedirectUri, markRedirectPending } from './redirect-state';
import { BUILT_IN_CLIENT_ID } from './built-in-client';

/**
 * One MSAL instance per auth context, cached as the *initialisation promise* so
 * concurrent first calls share it — two instances would both run
 * `handleRedirectPromise`, and only one of them can consume the response.
 */
const pool = new Map<string, Promise<PublicClientApplication>>();
/**
 * Auth response picked up by `handleRedirectPromise`, consumed by the next
 * `acquireToken` *for the same environment*. Keyed by auth context, which every
 * profile on the built-in registration shares — so the scope is checked on the
 * way out (`takeRedirectResult`) before the token is handed to anyone.
 */
const redirectResults = new Map<string, AuthenticationResult>();

function appKey(conn: FnoConnection): string {
  return authContextKey(conn, BUILT_IN_CLIENT_ID);
}

/** `https://env.dynamics.com/.default` → `https://env.dynamics.com`, lower-cased. */
function scopeResource(scope: string): string {
  const trimmed = scope.trim().replace(/\/\.default$/i, '').replace(/\/+$/, '');
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * True when a redirect response was issued for `scope`. The redirect request
 * carries the scope in its `state`, which Entra echoes back verbatim; the
 * granted scopes are the fallback for a response without it.
 */
export function redirectResultMatchesScope(
  result: Pick<AuthenticationResult, 'state' | 'scopes'>,
  scope: string,
): boolean {
  const wanted = scopeResource(scope);
  if (result.state) return scopeResource(result.state) === wanted;
  return (result.scopes ?? []).some(s => scopeResource(s) === wanted);
}

/** Hand out (once) the redirect response for this connection's environment, if any. */
function takeRedirectResult(conn: FnoConnection, scope: string): AuthenticationResult | null {
  const key = appKey(conn);
  const result = redirectResults.get(key);
  if (!result || !redirectResultMatchesScope(result, scope)) return null;
  redirectResults.delete(key);
  return result;
}

/**
 * Where Microsoft identity should send the browser back to. Defined in
 * `redirect-state` so it is reachable without loading MSAL.
 */
export { computeRedirectUri } from './redirect-state';

function getOrCreate(conn: FnoConnection): Promise<PublicClientApplication> {
  const key = appKey(conn);
  const existing = pool.get(key);
  if (existing) return existing;
  const created = createApp(conn, key);
  pool.set(key, created);
  // A failed initialisation must not stick: the next call gets a fresh try.
  created.catch(() => {
    if (pool.get(key) === created) pool.delete(key);
  });
  return created;
}

async function createApp(conn: FnoConnection, key: string): Promise<PublicClientApplication> {
  const config: Configuration = {
    auth: {
      clientId: resolveClientId(conn, BUILT_IN_CLIENT_ID),
      authority: buildAuthority(conn.tenantId),
      redirectUri: computeRedirectUri(),
      navigateToLoginRequestUrl: false,
    },
    cache: {
      cacheLocation: 'sessionStorage',
      // Safari/iPadOS partition or evict sessionStorage around a cross-site
      // navigation; the cookie copy keeps the redirect flow's state alive.
      storeAuthStateInCookie: true,
    },
    system: {
      loggerOptions: {
        // Verbose in dev only: this is what tells you whether the popup was
        // ever navigated ("Navigating popup window to: …") or died earlier.
        logLevel: import.meta.env.DEV ? LogLevel.Verbose : LogLevel.Error,
        piiLoggingEnabled: false,
        loggerCallback: (level, message) => {
          if (level === LogLevel.Error) console.error('[msal]', message);
          else if (import.meta.env.DEV) console.debug('[msal]', message);
        },
      },
    },
  };
  const app = new PublicClientApplication(config);
  await app.initialize();
  // Completes a sign-in that finished via the redirect fallback below.
  try {
    const redirectResult = await app.handleRedirectPromise();
    if (redirectResult) {
      console.info('[BrowserAuthProvider] completed sign-in via redirect');
      redirectResults.set(key, redirectResult);
      clearRedirectPending();
    }
  } catch (err) {
    console.error('[BrowserAuthProvider] handleRedirectPromise failed', err);
    clearRedirectPending();
  }
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

/**
 * Popup failures that mean "this browser/page will not let a popup complete the
 * flow" — as opposed to the user cancelling or the server rejecting the request.
 * These are worth retrying as a full-page redirect.
 */
function isPopupUnusable(err: unknown): boolean {
  if (err instanceof BrowserAuthError) {
    return (
      err.errorCode === 'popup_window_error' ||
      err.errorCode === 'empty_window_error' ||
      err.errorCode === 'monitor_window_timeout' ||
      err.errorCode === 'block_iframe_reload'
    );
  }
  return /popup|blocked|timed out/i.test(err instanceof Error ? err.message : '');
}

function buildSignInErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : '';
  const origin = typeof window !== 'undefined' ? computeRedirectUri() : '<unknown>';
  const looksLikeCsp = /Content Security Policy|violates the document's Content Security/i.test(raw);
  if (looksLikeCsp) {
    return (
      `Sign-in failed: the page's Content Security Policy blocked the request to Microsoft identity endpoints.\n` +
      `Update the CSP (meta tag in index.html or response header) to allow:\n` +
      `    connect-src https://login.microsoftonline.com https://*.dynamics.com\n` +
      `    frame-src  https://login.microsoftonline.com\n` +
      `    form-action https://login.microsoftonline.com`
    );
  }
  const looksLikeCors =
    /post_request_failed|Network request failed|CORS|Failed to fetch|NetworkError/i.test(raw);
  if (looksLikeCors) {
    return (
      `Sign-in failed: the Microsoft identity endpoint blocked the token request (CORS).\n` +
      `Register this exact redirect URI as a Single-page application (SPA) in the Azure App registration:\n` +
      `    ${origin}\n` +
      `Azure Portal → App registrations → Authentication → Add a platform → Single-page application.\n` +
      `The URI must match exactly (no trailing slash) and must NOT also be listed under the "Web" platform.\n` +
      `Note: each Vercel preview deployment has its own hostname and must be registered separately.`
    );
  }
  return raw ? `Sign-in failed: ${raw}` : 'Sign-in failed';
}

export class BrowserAuthProvider implements AuthProvider {
  async acquireToken(conn: FnoConnection): Promise<AuthResult> {
    const app = await getOrCreate(conn);
    const scope = buildFnoScope(conn);
    const scopes = [scope];
    const silent = await this.trySilent(app, conn, scope);
    if (silent) return silent;
    try {
      const popup = await app.acquireTokenPopup({ scopes, prompt: 'select_account' });
      return resultToAuth(popup, conn.envUrl);
    } catch (err) {
      console.error('[BrowserAuthProvider] acquireTokenPopup failed', err);
      if (isPopupUnusable(err)) {
        // The popup could not carry the flow (blocked, never navigated away
        // from about:blank, or timed out waiting for the response). Redirect
        // the whole tab instead — it works wherever a popup does not, and
        // `handleRedirectPromise` above finishes the sign-in on the way back.
        console.warn('[BrowserAuthProvider] popup unusable, falling back to redirect');
        markRedirectPending(conn.id);
        // `state` comes back verbatim — it is how the response is matched to
        // this environment and not handed to another profile's request.
        await app.acquireTokenRedirect({ scopes, prompt: 'select_account', state: scope });
        // acquireTokenRedirect navigates away; this never resolves normally.
        return new Promise<AuthResult>(() => {});
      }
      throw new FnoAuthError(buildSignInErrorMessage(err), err);
    }
  }

  /**
   * Token without any UI: the redirect response, or MSAL's silent flow.
   * `null` when either would need the user. Never opens a popup or navigates —
   * safe to call without a user gesture (e.g. right after a redirect reload).
   */
  async acquireTokenSilentOnly(conn: FnoConnection): Promise<AuthResult | null> {
    const app = await getOrCreate(conn);
    return this.trySilent(app, conn, buildFnoScope(conn));
  }

  private async trySilent(
    app: PublicClientApplication,
    conn: FnoConnection,
    scope: string,
  ): Promise<AuthResult | null> {
    // A sign-in that completed through the redirect fallback is already done —
    // hand back its token instead of starting a new interactive round trip.
    const fromRedirect = takeRedirectResult(conn, scope);
    if (fromRedirect) return resultToAuth(fromRedirect, conn.envUrl);
    const accounts = app.getAllAccounts();
    if (accounts.length === 0) return null;
    try {
      const silent = await app.acquireTokenSilent({ account: accounts[0], scopes: [scope] });
      return resultToAuth(silent, conn.envUrl);
    } catch {
      // Every silent-token failure (InteractionRequiredAuthError, expired
      // refresh token, network, ...) means "needs the user".
      return null;
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
