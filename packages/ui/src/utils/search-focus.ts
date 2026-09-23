import { useEffect, type RefObject } from 'react';

/**
 * Opening Search (the activity bar, Ctrl+F) puts the cursor in its box. The
 * panel may not be on screen yet when that is asked for, so the request waits
 * until the input is mounted and visible.
 */
const FOCUS_EVENT = 'er:focus-search';
let pending = false;

export function requestSearchFocus(): void {
  pending = true;
  window.dispatchEvent(new Event(FOCUS_EVENT));
}

/** Whether the search box has the keyboard — Ctrl+F then closes the panel instead of refocusing it. */
export function isSearchInputFocused(): boolean {
  return document.activeElement instanceof HTMLElement && document.activeElement.dataset.searchInput === 'true';
}

export function useSearchFocusTarget(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const run = () => {
      if (!pending) return;
      const input = ref.current;
      // Not laid out yet (the panel is still opening): try again next frame.
      if (!input || input.offsetParent === null) {
        if (tries++ < 20) frame = requestAnimationFrame(run);
        return;
      }
      pending = false;
      tries = 0;
      input.focus();
      input.select();
    };
    run();
    const onRequest = () => { tries = 0; run(); };
    window.addEventListener(FOCUS_EVENT, onRequest);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(FOCUS_EVENT, onRequest);
    };
  }, [ref]);
}
