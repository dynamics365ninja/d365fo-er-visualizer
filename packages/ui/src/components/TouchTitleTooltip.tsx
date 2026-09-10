import { useEffect, useRef, useState } from 'react';
import { useCoarsePointer } from '../utils/responsive';

/**
 * Long-press tooltip for touch devices.
 *
 * The app leans heavily on the native `title` attribute — full paths, resolved
 * labels, expressions, keyboard hints. A touch pointer never hovers, so on a
 * tablet all of that information is simply unreachable. Rather than converting
 * ~200 call sites to Fluent tooltips, this listens at the document level and
 * surfaces the `title` of whatever the user presses and holds.
 *
 * Only mounted behaviour on coarse pointers; on mouse/trackpad the native
 * tooltip already does the job and this stays completely inert.
 */

const LONG_PRESS_MS = 450;
/** Cancel the press if the finger travels further than this (i.e. it's a scroll). */
const MOVE_TOLERANCE_PX = 10;
const AUTO_HIDE_MS = 6000;
const MAX_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
/**
 * How long after a long press the trailing click is still considered part of
 * that gesture. A long press on touch does not always produce a click at all
 * (the platform may suppress it), so the swallow flag has to expire on its own
 * — otherwise it would sit armed and eat the *next* unrelated tap.
 */
const SWALLOW_WINDOW_MS = 800;

/**
 * Controls act on tap, so a long press on one must never be hijacked into a
 * tooltip: the tap that follows would be swallowed and the control would look
 * dead. That is exactly what happened to the kebab menus on a tablet — resting
 * a finger on the small target for over {@link LONG_PRESS_MS} meant the menu
 * never opened. Their `title` is still reachable by hovering on a desktop.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="option"]',
].join(',');

interface TipState {
  text: string;
  /** Anchor rect in viewport coordinates. */
  anchor: { top: number; bottom: number; left: number; right: number };
}

export function TouchTitleTooltip() {
  const coarse = useCoarsePointer();
  const [tip, setTip] = useState<TipState | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  /** Deadline until which the trailing click of a long press is dropped. */
  const swallowUntilRef = useRef(0);

  useEffect(() => {
    if (!coarse) return;

    const clearTimer = () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      setTip(null);
      clearTimer();
      swallowUntilRef.current = 0;
      originRef.current = { x: event.clientX, y: event.clientY };

      const target = event.target as Element | null;
      if (!target?.closest) return;
      // Never hijack a press on a control — see INTERACTIVE_SELECTOR.
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      // The nearest ancestor that actually carries a title — titles are set on
      // labels and pills nested inside the interactive row.
      const el = target.closest('[title]:not([title=""])') as HTMLElement | null;
      if (!el) return;
      const text = el.getAttribute('title');
      if (!text) return;

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const rect = el.getBoundingClientRect();
        swallowUntilRef.current = Date.now() + SWALLOW_WINDOW_MS;
        setTip({
          text,
          anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        });
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (event: PointerEvent) => {
      const origin = originRef.current;
      if (!origin || timerRef.current == null) return;
      if (
        Math.abs(event.clientX - origin.x) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - origin.y) > MOVE_TOLERANCE_PX
      ) {
        clearTimer();
      }
    };

    const onPointerEnd = () => {
      clearTimer();
      originRef.current = null;
    };

    // A long press is also a `click` as far as the DOM is concerned; letting it
    // through would select the row the user was only asking about. The window
    // is time-bound so a suppressed click never leaves the flag armed.
    const onClickCapture = (event: MouseEvent) => {
      if (Date.now() > swallowUntilRef.current) return;
      swallowUntilRef.current = 0;
      event.preventDefault();
      event.stopPropagation();
    };

    const onScroll = () => {
      clearTimer();
      setTip(null);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerEnd, true);
    document.addEventListener('pointercancel', onPointerEnd, true);
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return () => {
      clearTimer();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerEnd, true);
      document.removeEventListener('pointercancel', onPointerEnd, true);
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [coarse]);

  // Auto-dismiss, so a stray tooltip never sits on top of the tree forever.
  useEffect(() => {
    if (!tip) return;
    const id = window.setTimeout(() => setTip(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [tip]);

  // Measure after paint and flip above/below, so a tooltip near the bottom of
  // the screen does not end up off-viewport.
  useEffect(() => {
    if (!tip) return;
    const card = cardRef.current;
    if (!card) return;
    const { anchor } = tip;
    const width = Math.min(MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const height = card.offsetHeight;
    const centre = (anchor.left + anchor.right) / 2;
    const left = Math.min(
      Math.max(centre - width / 2, VIEWPORT_MARGIN),
      window.innerWidth - width - VIEWPORT_MARGIN,
    );
    const fitsAbove = anchor.top - height - 10 >= VIEWPORT_MARGIN;
    const top = fitsAbove
      ? anchor.top - height - 10
      : Math.min(anchor.bottom + 10, window.innerHeight - height - VIEWPORT_MARGIN);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(Math.max(top, VIEWPORT_MARGIN))}px`;
    card.style.visibility = 'visible';
  }, [tip]);

  if (!coarse || !tip) return null;

  return (
    <div
      ref={cardRef}
      className="touch-title-tip"
      role="tooltip"
      style={{ maxWidth: MAX_WIDTH, visibility: 'hidden' }}
      onClick={() => setTip(null)}
    >
      {tip.text}
    </div>
  );
}
