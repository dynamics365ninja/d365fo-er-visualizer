import { useEffect, useState } from 'react';

/**
 * Breakpoint below which the workspace drops to two columns: the designer plus
 * at most one side panel. Tablets in portrait (an iPad Pro 11 is 834 px) land
 * here — three panels would leave every one of them unusably thin, but a single
 * column wastes the width they do have.
 */
export const COMPACT_LAYOUT_QUERY = '(max-width: 900px)';
/** Breakpoint below which even two columns do not fit and panes stack. */
export const STACKED_LAYOUT_QUERY = '(max-width: 640px)';
/** True for touch/pen input — no hover, larger hit targets needed. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * Subscribes to a CSS media query from React.
 *
 * SSR-safe (the marketing site renders the SPA shell): falls back to `false`
 * when `window`/`matchMedia` is unavailable.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mq.addEventListener('change', onChange);
    // Re-sync: the query may have changed, or the environment moved between
    // the lazy initialiser and this effect.
    setMatches(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}

export function useStackedLayout(): boolean {
  return useMediaQuery(STACKED_LAYOUT_QUERY);
}

export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
