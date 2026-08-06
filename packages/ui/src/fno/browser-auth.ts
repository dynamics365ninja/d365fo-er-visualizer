/**
 * Browser-side auth adapter wrapping MSAL Browser. Used when running the UI
 * as a plain SPA (not in Electron). Popup first, redirect as a fallback.
 */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  BrowserAuthError,
  LogLevel,
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

/** Set while an interactive redirect is pending, so the caller can stay quiet. */
const REDIRECT_PENDING_KEY = 'er-visualizer.fnoRedirectPending';

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
      sessionStorage.removeItem(REDIRECT_PENDING_KEY);
      console.info('[BrowserAuthProvider] completed sign-in via redirect');
    }
  } catch (err) {
    console.error('[BrowserAuthProvider] handleRedirectPromise failed', err);
  }
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
  const origin = typeof window !== 'undefined' ? window.location.origin : '<unknown>';
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
      console.error('[BrowserAuthProvider] acquireTokenPopup failed', err);
      if (isPopupUnusable(err)) {
        // The popup could not carry the flow (blocked, never navigated away
        // from about:blank, or timed out waiting for the response). Redirect
        // the whole tab instead — it works wherever a popup does not, and
        // `handleRedirectPromise` above finishes the sign-in on the way back.
        console.warn('[BrowserAuthProvider] popup unusable, falling back to redirect');
        sessionStorage.setItem(REDIRECT_PENDING_KEY, conn.id);
        await app.acquireTokenRedirect({ scopes, prompt: 'select_account' });
        // acquireTokenRedirect navigates away; this never resolves normally.
        return new Promise<AuthResult>(() => {});
      }
      throw new FnoAuthError(buildSignInErrorMessage(err), err);
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
