import { describe, expect, it } from 'vitest';
import { sanitizeProfiles } from './fno-profiles';

describe('sanitizeProfiles', () => {
  it('turns a non-array value into no profiles', () => {
    expect(sanitizeProfiles(null)).toEqual([]);
    expect(sanitizeProfiles({ id: 'p1', envUrl: 'https://x' })).toEqual([]);
  });

  it('drops profiles without an id or environment and fields of the wrong type', () => {
    expect(sanitizeProfiles([
      null,
      'profile',
      { id: 'no-env' },
      { envUrl: 'https://no-id' },
      {
        id: 'p1',
        envUrl: 'https://env.operations.dynamics.com',
        createdAt: 10,
        clientId: 42,
        lastUsedAt: 'yesterday',
        extraRoots: ['Model', 7],
      },
    ])).toEqual([
      {
        id: 'p1',
        displayName: 'https://env.operations.dynamics.com',
        envUrl: 'https://env.operations.dynamics.com',
        createdAt: 10,
        extraRoots: ['Model'],
      },
    ]);
  });
});
