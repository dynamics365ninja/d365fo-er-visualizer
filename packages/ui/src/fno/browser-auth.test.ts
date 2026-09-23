import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FnoConnection } from '@er-visualizer/fno-client';

const msal = vi.hoisted(() => ({
  instances: 0,
  redirectResult: null as null | Record<string, unknown>,
  accounts: [] as unknown[],
  popup: vi.fn(),
  redirect: vi.fn(),
  silent: vi.fn(),
}));

vi.mock('@azure/msal-browser', () => {
  class PublicClientApplication {
    constructor() { msal.instances++; }
    async initialize() {}
    async handleRedirectPromise() {
      const r = msal.redirectResult;
      msal.redirectResult = null;
      return r;
    }
    getAllAccounts() { return msal.accounts; }
    acquireTokenSilent(...args: unknown[]) { return msal.silent(...args); }
    acquireTokenPopup(...args: unknown[]) { return msal.popup(...args); }
    acquireTokenRedirect(...args: unknown[]) { return msal.redirect(...args); }
    async clearCache() {}
  }
  class BrowserAuthError extends Error { errorCode = ''; }
  class InteractionRequiredAuthError extends Error {}
  return { PublicClientApplication, BrowserAuthError, InteractionRequiredAuthError, LogLevel: { Error: 0, Verbose: 4 } };
});

const { redirectResultMatchesScope } = await import('./browser-auth');

/** Fresh module per test: the MSAL instance pool and redirect results are module state. */
async function freshProvider() {
  vi.resetModules();
  const { BrowserAuthProvider } = await import('./browser-auth');
  return new BrowserAuthProvider();
}

function profile(envUrl: string, id = 'p1'): FnoConnection {
  return { id, displayName: 'P', envUrl, createdAt: 0 };
}

describe('redirectResultMatchesScope', () => {
  it('matches on the state the redirect request carried', () => {
    const r = { state: 'https://a.dynamics.com/.default', scopes: [] };
    expect(redirectResultMatchesScope(r, 'https://a.dynamics.com/.default')).toBe(true);
    expect(redirectResultMatchesScope(r, 'https://b.dynamics.com/.default')).toBe(false);
  });

  it('falls back to the granted scopes', () => {
    const r = { state: '', scopes: ['https://A.dynamics.com/user_impersonation'] };
    expect(redirectResultMatchesScope(r, 'https://a.dynamics.com/.default')).toBe(true);
    expect(redirectResultMatchesScope(r, 'https://b.dynamics.com/.default')).toBe(false);
  });
});

describe('BrowserAuthProvider', () => {
  beforeEach(() => {
    msal.accounts = [];
    msal.popup.mockReset();
    msal.redirect.mockReset();
    msal.silent.mockReset();
    msal.instances = 0;
    msal.redirectResult = null;
  });

  it('creates a single MSAL instance for concurrent first calls', async () => {
    const auth = await freshProvider();
    await Promise.all([
      auth.getAccount(profile('https://a.dynamics.com')),
      auth.getAccount(profile('https://b.dynamics.com', 'p2')),
    ]);
    expect(msal.instances).toBe(1);
  });

  it('silent-only resume never opens a popup or redirects', async () => {
    const auth = await freshProvider();
    expect(await auth.acquireTokenSilentOnly(profile('https://a.dynamics.com'))).toBeNull();
    msal.accounts = [{ username: 'u', tenantId: 't', homeAccountId: 'h' }];
    msal.silent.mockRejectedValue(new Error('interaction_required'));
    expect(await auth.acquireTokenSilentOnly(profile('https://a.dynamics.com'))).toBeNull();
    expect(msal.popup).not.toHaveBeenCalled();
    expect(msal.redirect).not.toHaveBeenCalled();
  });

  it('tags the redirect fallback with the requested scope', async () => {
    const err = Object.assign(new Error('popup blocked'), { errorCode: 'popup_window_error' });
    msal.popup.mockRejectedValue(err);
    msal.redirect.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const auth = await freshProvider();
    void auth.acquireToken(profile('https://a.dynamics.com'));
    await vi.waitFor(() => expect(msal.redirect).toHaveBeenCalled());
    expect(msal.redirect.mock.calls[0][0]).toMatchObject({ state: 'https://a.dynamics.com/.default' });
  });

  it('hands a redirect token only to the environment it was issued for', async () => {
    msal.redirectResult = {
      accessToken: 'token-a',
      state: 'https://a.dynamics.com/.default',
      scopes: ['https://a.dynamics.com/.default'],
      account: null,
      expiresOn: new Date(Date.now() + 3_600_000),
    };
    const auth = await freshProvider();
    expect(await auth.acquireTokenSilentOnly(profile('https://b.dynamics.com', 'p2'))).toBeNull();
    const a = await auth.acquireTokenSilentOnly(profile('https://a.dynamics.com'));
    expect(a?.accessToken).toBe('token-a');
  });
});
