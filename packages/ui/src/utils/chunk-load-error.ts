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
