import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './chunk-load-error';

describe('isChunkLoadError', () => {
  it.each([
    'Unable to preload CSS for /app/assets/DesignerView-BZV40eAE.css',
    'Failed to fetch dynamically imported module: http://localhost:3000/app/assets/DesignerView-BpAy4hHJ.js',
    'error loading dynamically imported module: http://localhost:3000/app/assets/DesignerView-BpAy4hHJ.js',
    'Importing a module script failed.',
  ])('recognises "%s"', message => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('leaves ordinary render errors alone', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
  });

  it('only accepts Error instances', () => {
    expect(isChunkLoadError('Unable to preload CSS for /app/assets/x.css')).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
