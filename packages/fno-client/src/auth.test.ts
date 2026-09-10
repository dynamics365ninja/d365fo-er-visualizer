import { describe, it, expect } from 'vitest';
import { buildFnoScope, buildAuthority, resolveClientId, authContextKey } from './auth';
import { FnoAuthError, type FnoConnection } from './types';

function conn(overrides: Partial<FnoConnection> = {}): FnoConnection {
  return {
    id: '1',
    displayName: '',
    envUrl: 'https://org.operations.dynamics.com',
    createdAt: 0,
    ...overrides,
  };
}

describe('buildFnoScope', () => {
  it('appends /.default and trims trailing slash', () => {
    expect(buildFnoScope({
      id: '1',
      displayName: '',
      envUrl: 'https://org.operations.dynamics.com/',
      createdAt: 0,
    })).toBe('https://org.operations.dynamics.com/.default');
  });
});

describe('buildAuthority', () => {
  it('URL-encodes the tenant', () => {
    expect(buildAuthority('contoso.onmicrosoft.com'))
      .toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com');
  });

  it('falls back to the organizations authority when no tenant is given', () => {
    expect(buildAuthority()).toBe('https://login.microsoftonline.com/organizations');
    expect(buildAuthority('')).toBe('https://login.microsoftonline.com/organizations');
    expect(buildAuthority('   ')).toBe('https://login.microsoftonline.com/organizations');
  });
});

describe('resolveClientId', () => {
  it('prefers the profile client id over the built-in one', () => {
    expect(resolveClientId(conn({ clientId: 'own' }), 'built-in')).toBe('own');
  });

  it('falls back to the built-in client id when the profile has none', () => {
    expect(resolveClientId(conn(), 'built-in')).toBe('built-in');
    expect(resolveClientId(conn({ clientId: '  ' }), 'built-in')).toBe('built-in');
  });

  it('throws when neither is available', () => {
    expect(() => resolveClientId(conn())).toThrow(FnoAuthError);
    expect(() => resolveClientId(conn(), '  ')).toThrow(FnoAuthError);
  });
});

describe('authContextKey', () => {
  it('shares one key across URL-only profiles so sign-in is reused', () => {
    expect(authContextKey(conn({ id: 'a' }), 'built-in'))
      .toBe(authContextKey(conn({ id: 'b', envUrl: 'https://other.dynamics.com' }), 'built-in'));
  });

  it('separates profiles that pin their own registration', () => {
    expect(authContextKey(conn({ tenantId: 't', clientId: 'c' }), 'built-in')).toBe('t::c');
    expect(authContextKey(conn(), 'built-in')).toBe('organizations::built-in');
  });
});
