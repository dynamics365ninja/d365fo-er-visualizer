import { describe, it, expect } from 'vitest';
import { buildFnoScope, buildAuthority, defaultBrowserRedirectUri } from './auth';

describe('buildFnoScope', () => {
  it('appends /.default and trims trailing slash', () => {
    expect(buildFnoScope({
      id: '1',
      displayName: '',
      envUrl: 'https://org.operations.dynamics.com/',
      tenantId: 't',
      clientId: 'c',
      createdAt: 0,
    })).toBe('https://org.operations.dynamics.com/.default');
  });
});

describe('buildAuthority', () => {
  it('URL-encodes the tenant', () => {
    expect(buildAuthority('contoso.onmicrosoft.com'))
      .toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com');
  });
});

describe('defaultBrowserRedirectUri', () => {
  it('normalizes origin', () => {
    expect(defaultBrowserRedirectUri('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(defaultBrowserRedirectUri('http://localhost:5173')).toBe('http://localhost:5173/');
  });
});
