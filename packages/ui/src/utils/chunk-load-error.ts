/**
 * What a lazily loaded chunk fails with when it cannot be downloaded — the
 * server went away, or a new build replaced the hashed files under a page that
 * was already open. In order: Vite's stylesheet preload, then the dynamic
 * import in Chromium, Firefox and Safari.
 */
const CHUNK_LOAD_ERROR =
  /Unable to preload CSS|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_ERROR.test(error.message);
}

const RELOAD_KEY = 'er-visualizer.chunkReloadAt';
/** A second failure this soon after a reload means reloading does not help. */
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Reload the page to pick up the current build, at most once per cooldown so
 * a server that is really down ends on the error screen instead of a reload
 * loop. Returns whether a reload was started.
 */
export function reloadOnceForChunkError(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSessionStorage(),
  reload: () => void = () => window.location.reload(),
  now: number = Date.now(),
): boolean {
  if (!storage) return false;
  const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
  if (now - last < RELOAD_COOLDOWN_MS) return false;
  try {
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
