import { useCallback, useEffect, useLayoutEffect, useReducer, useState, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { withPinnedIndexes } from './flat-tree';

export interface VirtualTreeOptions {
  /** The rows, in display order; `id` keys each row's measured size. */
  rows: ReadonlyArray<{ id: string }>;
  /** The element that scrolls — usually an ancestor of the list, not the list itself. */
  scrollRef: RefObject<HTMLElement | null>;
  /** The element the rows are positioned in; its offset in the scroller becomes the scroll margin. */
  containerRef: RefObject<HTMLElement | null>;
  /** A first guess at a row's height; every rendered row is measured. */
  estimateSize: number;
  /** Rows that stay mounted wherever the list is scrolled (the tab stop, the focused row). */
  pinned?: ReadonlyArray<number | null | undefined>;
  paddingStart?: number;
  overscan?: number;
}

/**
 * `useVirtualizer` for a tree rendered inside a larger scroll pane: the rows
 * share the pane with headers, toolbars or other lists, so the list's own
 * offset in the pane is measured (and re-measured whenever something in the
 * pane changes size) and handed over as the scroll margin.
 *
 * Rows are measured, not fixed-height: a row can carry an open binding card,
 * a second line, or the taller touch hit target.
 */
export function useVirtualTree({ rows, scrollRef, containerRef, estimateSize, pinned, paddingStart = 0, overscan = 12 }: VirtualTreeOptions) {
  const count = rows.length;
  const [scrollMargin, setScrollMargin] = useState(0);

  const measureMargin = useCallback(() => {
    const scroller = scrollRef.current;
    const container = containerRef.current;
    if (!scroller || !container) return;
    const margin = container.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
    setScrollMargin(prev => (Math.abs(prev - margin) < 0.5 ? prev : margin));
  }, [scrollRef, containerRef]);

  // Cheap enough to redo on every render: anything above the list that
  // re-rendered with it may have moved it.
  useLayoutEffect(measureMargin);

  // …and anything that changed size without re-rendering the list (another
  // list growing above it, the pane itself being resized).
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureMargin());
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [scrollRef, measureMargin, count]);

  const pinnedKey = (pinned ?? []).join(',');
  const rangeExtractor = useCallback(
    (range: Range) => withPinnedIndexes(defaultRangeExtractor(range), pinned ?? [], range.count),
    // Keyed on the pinned values, not the array: a new extractor is what
    // makes the virtualizer recompute its indexes.
    [pinnedKey],
  );

  // Stable per row list: a new key function makes the virtualizer rebuild
  // every row's measurement, which on every scroll frame adds up.
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? String(index), [rows]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    // The virtualizer scrolls its element to this offset when it attaches to
    // it; the pane is shared and may already be scrolled.
    initialOffset: () => scrollRef.current?.scrollTop ?? 0,
    estimateSize: () => estimateSize,
    getItemKey,
    overscan,
    paddingStart,
    scrollMargin,
    rangeExtractor,
  });

  // The scroll pane is usually an ancestor, and an ancestor's ref is attached
  // only after this list's layout effects ran — so on mount the virtualizer
  // found no element to listen to. One more render once it is there.
  const [, attach] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (scrollRef.current && virtualizer.scrollElement !== scrollRef.current) attach();
  });

  return { virtualizer, scrollMargin };
}
