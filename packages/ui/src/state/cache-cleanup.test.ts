import { afterEach, describe, expect, it, vi } from 'vitest';

const deleted: string[] = [];
vi.mock('../utils/content-cache', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/content-cache')>();
  return {
    ...actual,
    listCachedPaths: vi.fn(async () => ['old.xml', 'fresh.xml', 'bundle.xml']),
    deleteFileContent: vi.fn(async (path: string) => { deleted.push(path); }),
    readFileContent: vi.fn(async () => null),
  };
});

const { useAppStore } = await import('./store');

afterEach(() => {
  vi.useRealTimers();
  deleted.length = 0;
  useAppStore.setState({ toasts: [], recentFiles: [], recentSessions: [], cachedPaths: new Set() });
});

describe('cached content after clearing the history', () => {
  it('keeps what was opened after "Clear history" was clicked', async () => {
    vi.useFakeTimers();
    useAppStore.setState({ recentFiles: [{ path: 'old.xml', name: 'old.xml', openedAt: 1 }] as any[] });
    useAppStore.getState().clearRecentFiles();
    // Opened before the undo window ran out.
    useAppStore.setState({ recentFiles: [
      { path: 'fresh.xml', name: 'fresh.xml', openedAt: 2 },
      { path: 'bundle.xml#datamodel:{A}', name: 'bundle.xml', bundlePath: 'bundle.xml', openedAt: 3 },
    ] as any[] });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(deleted).toEqual(['old.xml']);
  });

  it('keeps a removed file that was opened again meanwhile', async () => {
    vi.useFakeTimers();
    const entry = { path: 'fresh.xml', name: 'fresh.xml', openedAt: 1 };
    useAppStore.setState({ recentFiles: [entry] as any[], cachedPaths: new Set(['fresh.xml']) });
    useAppStore.getState().removeRecentFile('fresh.xml');
    useAppStore.setState({ recentFiles: [entry] as any[] });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(deleted).toEqual([]);
  });

  it('stops offering a session whose content is gone', async () => {
    useAppStore.setState({
      cachedPaths: new Set(['gone.xml']),
      recentSessions: [{ id: 's', openedAt: 1, files: [{ path: 'gone.xml', name: 'gone.xml', openedAt: 1 }] }] as any[],
    });
    expect(await useAppStore.getState().loadRecentSession('s')).toBe(false);
    expect(useAppStore.getState().cachedPaths.has('gone.xml')).toBe(false);
  });
});
