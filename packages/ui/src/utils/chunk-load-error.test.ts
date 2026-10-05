import { describe, expect, it } from 'vitest';
import { isChunkLoadError, reloadOnceForChunkError } from './chunk-load-error';

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

describe('reloadOnceForChunkError', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  }

  it('reloads once, then gives up while the cooldown runs', () => {
    const storage = memoryStorage();
    let reloads = 0;
    const reload = () => { reloads++; };
    expect(reloadOnceForChunkError(storage, reload, 100_000)).toBe(true);
    expect(reloadOnceForChunkError(storage, reload, 110_000)).toBe(false);
    expect(reloads).toBe(1);
  });

  it('reloads again once the cooldown has passed', () => {
    const storage = memoryStorage();
    const reload = () => {};
    reloadOnceForChunkError(storage, reload, 100_000);
    expect(reloadOnceForChunkError(storage, reload, 200_000)).toBe(true);
  });

  it('does not reload without storage to guard against a loop', () => {
    expect(reloadOnceForChunkError(null, () => { throw new Error('no'); })).toBe(false);
  });
});
