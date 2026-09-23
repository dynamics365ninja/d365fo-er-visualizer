import { useCallback, useState } from 'react';

const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

/**
 * Open/closed state of a virtualized tree's rows, held above the rows.
 *
 * A recursive tree could keep it in each row, but a virtualized one unmounts
 * rows as they scroll away, which would forget what the user opened. The
 * state is a set of per-row overrides on top of a default the caller derives
 * (from an expand-all / collapse-all mode, say); a new `resetKey` drops the
 * overrides, the same way "expand all" used to reset every row.
 */
export function useTreeOpenState(resetKey: string) {
  const [state, setState] = useState<{ key: string; overrides: ReadonlyMap<string, boolean> }>(
    () => ({ key: resetKey, overrides: NO_OVERRIDES }),
  );
  // A stale key reads as "no overrides" during the very render the key
  // changes in, rather than one render later from an effect.
  const overrides = state.key === resetKey ? state.overrides : NO_OVERRIDES;

  const setOpen = useCallback((ids: string | Iterable<string>, open: boolean) => {
    setState(prev => {
      const current = prev.key === resetKey ? prev.overrides : NO_OVERRIDES;
      let next: Map<string, boolean> | null = null;
      for (const id of typeof ids === 'string' ? [ids] : ids) {
        if (current.get(id) === open) continue;
        next ??= new Map(current);
        next.set(id, open);
      }
      if (!next) return prev.key === resetKey ? prev : { key: resetKey, overrides: current };
      return { key: resetKey, overrides: next };
    });
  }, [resetKey]);

  return { overrides, setOpen };
}
