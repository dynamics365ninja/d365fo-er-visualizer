import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthResult, FnoConnection } from '@er-visualizer/fno-client';

const provider = {
  acquireToken: vi.fn<(conn: FnoConnection, signal?: AbortSignal) => Promise<AuthResult>>(),
  signOut: vi.fn(async () => {}),
  getAccount: vi.fn(async () => null),
  acquireTokenSilentOnly: undefined as undefined | ((conn: FnoConnection) => Promise<AuthResult | null>),
};

vi.mock('./auth-factory', () => ({ getAuthProvider: async () => provider }));
vi.mock('./transport', () => ({ createFnoTransport: () => ({}) }));
vi.mock('@er-visualizer/fno-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@er-visualizer/fno-client')>();
  return {
    ...actual,
    // Echo the token back so tests can see which one was sent.
    listSolutions: vi.fn(async (_t: unknown, _c: unknown, token: string) => [{ solutionName: token }]),
  };
});

const { fnoSession, tokenCacheKey } = await import('./session');

function profile(envUrl: string, id = 'p1'): FnoConnection {
  return { id, displayName: 'P', envUrl, createdAt: 0 };
}

function tokenFor(conn: FnoConnection): AuthResult {
  return { accessToken: `token:${conn.envUrl}`, expiresAt: Date.now() + 3_600_000, envUrl: conn.envUrl };
}

async function tokenSentFor(conn: FnoConnection): Promise<string | undefined> {
  const [row] = await fnoSession.listSolutions(conn);
  return row.solutionName;
}

describe('fnoSession token cache', () => {
  beforeEach(() => {
    fnoSession.clearTokenCache();
    provider.acquireToken.mockReset();
    provider.acquireToken.mockImplementation(async conn => tokenFor(conn));
    provider.acquireTokenSilentOnly = undefined;
  });

  it('keys tokens by the environment, not just the profile id', () => {
    expect(tokenCacheKey(profile('https://a.dynamics.com')))
      .not.toBe(tokenCacheKey(profile('https://b.dynamics.com')));
  });

  it('reuses a cached token for the same environment', async () => {
    const conn = profile('https://a.dynamics.com');
    await tokenSentFor(conn);
    await tokenSentFor(conn);
    expect(provider.acquireToken).toHaveBeenCalledTimes(1);
  });

  it('never sends a token for the old URL after the profile was edited', async () => {
    await tokenSentFor(profile('https://a.dynamics.com'));
    // Same id, new URL — what saving an edited profile produces.
    expect(await tokenSentFor(profile('https://b.dynamics.com'))).toBe('token:https://b.dynamics.com');
    expect(provider.acquireToken).toHaveBeenCalledTimes(2);
  });

  it('clearTokenCache(id) forces a fresh token for that profile only', async () => {
    const a = profile('https://a.dynamics.com', 'p1');
    const b = profile('https://b.dynamics.com', 'p2');
    await tokenSentFor(a);
    await tokenSentFor(b);
    fnoSession.clearTokenCache('p1');
    await tokenSentFor(a);
    await tokenSentFor(b);
    expect(provider.acquireToken).toHaveBeenCalledTimes(3);
  });

  it('does not acquire a token for an already cancelled request', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(fnoSession.listSolutions(profile('https://a.dynamics.com'), ctrl.signal)).rejects.toThrow();
    expect(provider.acquireToken).not.toHaveBeenCalled();
  });
});

describe('fnoSession.resumeSignIn', () => {
  beforeEach(() => {
    fnoSession.clearTokenCache();
    provider.acquireToken.mockReset();
  });

  it('never falls back to the interactive flow', async () => {
    provider.acquireTokenSilentOnly = undefined;
    expect(await fnoSession.resumeSignIn(profile('https://a.dynamics.com'))).toBeNull();
    provider.acquireTokenSilentOnly = async () => null;
    expect(await fnoSession.resumeSignIn(profile('https://a.dynamics.com'))).toBeNull();
    expect(provider.acquireToken).not.toHaveBeenCalled();
  });

  it('caches a silently resumed token', async () => {
    const conn = profile('https://a.dynamics.com');
    provider.acquireTokenSilentOnly = async c => tokenFor(c);
    expect(await fnoSession.resumeSignIn(conn)).not.toBeNull();
    expect(await tokenSentFor(conn)).toBe('token:https://a.dynamics.com');
    expect(provider.acquireToken).not.toHaveBeenCalled();
  });
});
