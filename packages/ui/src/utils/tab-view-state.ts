import { useCallback, useState } from 'react';

/**
 * Per-tab view state for the designer panel.
 *
 * The middle panel mounts only the tab that is currently active, and React
 * reuses that one component instance for every tab of the same kind. Both
 * halves of that are wrong for the user:
 *
 *  - state *leaks* — a filter typed on one format stayed applied after
 *    switching to another one;
 *  - state is *lost* — keying the designer per tab (which fixes the leak)
 *    would otherwise throw the chosen view away, so a tab left on the Preview
 *    came back on Structure.
 *
 * So the designer is keyed by tab id, and the few pieces of state the user
 * explicitly chose are cached here, outside React, and restored on mount.
 * Only deliberate choices belong here — scroll offsets and transient
 * selections are better off resetting.
 */
const cache = new Map<string, Map<string, unknown>>();

export function useTabState<T>(
  tabId: string | null | undefined,
  key: string,
  initial: T | (() => T),
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = tabId ? cache.get(tabId)?.get(key) : undefined;
    if (stored !== undefined) return stored as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      if (tabId) {
        let scope = cache.get(tabId);
        if (!scope) {
          scope = new Map();
          cache.set(tabId, scope);
        }
        scope.set(key, resolved);
      }
      return resolved;
    });
  }, [tabId, key]);

  return [value, set];
}

/** Forget the state of tabs the user has closed. */
export function pruneTabViewState(openTabIds: Iterable<string>): void {
  const keep = new Set(openTabIds);
  for (const id of Array.from(cache.keys())) {
    if (!keep.has(id)) cache.delete(id);
  }
}

/** Test seam — the cache is module state and would otherwise leak between cases. */
export function resetTabViewState(): void {
  cache.clear();
}
