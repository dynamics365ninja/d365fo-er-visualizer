import { describe, it, expect } from 'vitest';
import { parseJsonResponseText, describeUpstreamRedirect } from './http';
import { FnoHttpError } from './types';

describe('parseJsonResponseText', () => {
  it('parses JSON and maps an empty body to null', () => {
    expect(parseJsonResponseText('{"a":1}', 'u', 200)).toEqual({ a: 1 });
    expect(parseJsonResponseText('﻿[1]', 'u', 200)).toEqual([1]);
    expect(parseJsonResponseText('  ', 'u', 200)).toBeNull();
  });

  it('reports an HTML sign-in page as a 401 instead of empty content', () => {
    let caught: unknown;
    try {
      parseJsonResponseText('<!DOCTYPE html><html><body>Sign in</body></html>', 'https://e/x', 200);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FnoHttpError);
    expect(caught).toMatchObject({ status: 401, url: 'https://e/x' });
  });

  it('reports other non-JSON bodies as a 502', () => {
    expect(() => parseJsonResponseText('not json', 'u', 200)).toThrow(FnoHttpError);
    try {
      parseJsonResponseText('not json', 'u', 200);
    } catch (err) {
      expect((err as FnoHttpError).status).toBe(502);
    }
  });
});

describe('describeUpstreamRedirect', () => {
  it('names the status and the target', () => {
    const text = describeUpstreamRedirect(302, 'https://login.microsoftonline.com/x');
    expect(text).toContain('302');
    expect(text).toContain('https://login.microsoftonline.com/x');
  });
});
