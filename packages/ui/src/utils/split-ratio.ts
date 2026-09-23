import { useCallback, useEffect, useState } from 'react';

/** Share of the width the left group takes when the designer is split. */
const STORAGE_KEY = 'er-visualizer.designer-split-ratio';
export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
}

function readStoredRatio(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw == null ? 0.5 : clampSplitRatio(Number(raw));
  } catch {
    return 0.5;
  }
}

/** The split ratio, remembered per browser; a convenience, so storage may fail quietly. */
export function useSplitRatio(): [number, (ratio: number) => void] {
  const [ratio, setRatio] = useState(readStoredRatio);
  const update = useCallback((next: number) => {
    const clamped = clampSplitRatio(next);
    setRatio(clamped);
    try { window.localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);
  return [ratio, update];
}

/** Whether an element is narrower than `threshold` px, kept current as it resizes. */
export function useIsNarrow(element: HTMLElement | null, threshold: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      setNarrow(width > 0 && width < threshold);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, threshold]);
  return narrow;
}
