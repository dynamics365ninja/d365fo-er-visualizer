import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ContentCache = typeof import('./content-cache');

/**
 * The module keeps its connection in a module-level promise, so every test
 * gets a fresh copy of it and a fresh, empty IndexedDB. `window` is what the
 * module checks for, so it is pointed at the global scope fake-indexeddb
 * populates.
 */
async function loadCache(): Promise<ContentCache> {
  vi.resetModules();
  return import('./content-cache');
}

/** Record the connections the module opens, so a test can close one under it. */
function captureConnections(): IDBDatabase[] {
  const connections: IDBDatabase[] = [];
  const factory = globalThis.indexedDB;
  const open = factory.open.bind(factory);
  vi.spyOn(factory, 'open').mockImplementation((name: string, version?: number) => {
    const request = open(name, version);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  });
  return connections;
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('content cache', () => {
  it('saves, reads, lists and deletes file contents', async () => {
    const cache = await loadCache();

    expect(await cache.saveFileContent('a.xml', '<a/>')).toBe(true);
    expect(await cache.saveFileContent('b.xml', '<b/>')).toBe(true);
    expect(await cache.readFileContent('a.xml')).toBe('<a/>');
    expect(await cache.readFileContent('missing.xml')).toBeNull();
    expect((await cache.listCachedPaths()).sort()).toEqual(['a.xml', 'b.xml']);

    // A second save of the same path replaces the content.
    expect(await cache.saveFileContent('a.xml', '<a v="2"/>')).toBe(true);
    expect(await cache.readFileContent('a.xml')).toBe('<a v="2"/>');

    await cache.deleteFileContent('a.xml');
    expect(await cache.readFileContent('a.xml')).toBeNull();
    expect(await cache.listCachedPaths()).toEqual(['b.xml']);

    await cache.clearAllFileContent();
    expect(await cache.listCachedPaths()).toEqual([]);
  });

  it('reports a write that did not commit', async () => {
    const cache = await loadCache();
    // Open the database first so the failure hits the write, not the open.
    expect(await cache.listCachedPaths()).toEqual([]);

    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(await cache.saveFileContent('big.xml', '<big/>')).toBe(false);

    put.mockRestore();
    expect(await cache.readFileContent('big.xml')).toBeNull();
    expect(await cache.saveFileContent('big.xml', '<big/>')).toBe(true);
  });

  it('resolves to no-ops without IndexedDB', async () => {
    vi.stubGlobal('window', undefined);
    const cache = await loadCache();

    expect(await cache.saveFileContent('a.xml', '<a/>')).toBe(false);
    expect(await cache.readFileContent('a.xml')).toBeNull();
    expect(await cache.listCachedPaths()).toEqual([]);
    await expect(cache.deleteFileContent('a.xml')).resolves.toBeUndefined();
    await expect(cache.clearAllFileContent()).resolves.toBeUndefined();
  });

  it('reopens the database after the connection was closed', async () => {
    const connections = captureConnections();
    const cache = await loadCache();

    expect(await cache.saveFileContent('a.xml', '<a/>')).toBe(true);
    expect(connections).toHaveLength(1);

    // A connection closed without a `close` event (as `db.close()` does) only
    // shows when a transaction is refused; that call fails, the next reopens.
    connections[0].close();
    expect(await cache.readFileContent('a.xml')).toBeNull();
    expect(await cache.readFileContent('a.xml')).toBe('<a/>');
    expect(connections).toHaveLength(2);
    expect(await cache.saveFileContent('b.xml', '<b/>')).toBe(true);
  });

  it('reopens the database after another connection deleted it', async () => {
    const cache = await loadCache();
    expect(await cache.saveFileContent('a.xml', '<a/>')).toBe(true);

    // Deleting the database sends `versionchange` to the open connection,
    // which has to let go of it for the delete to go through.
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase('er-visualizer');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('delete blocked by the cached connection'));
    });

    expect(await cache.readFileContent('a.xml')).toBeNull();
    expect(await cache.saveFileContent('b.xml', '<b/>')).toBe(true);
    expect(await cache.listCachedPaths()).toEqual(['b.xml']);
  });
});
