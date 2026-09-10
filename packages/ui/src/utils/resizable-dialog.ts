import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface DialogSize { width: number; height: number }

export interface ResizableDialogOptions {
  /** localStorage bucket for the remembered size. */
  storageKey: string;
  minWidth: number;
  minHeight: number;
}

function clampSize(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readStoredDialogSize({ storageKey, minWidth, minHeight }: ResizableDialogOptions): DialogSize | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DialogSize>;
    if (typeof parsed?.width !== 'number' || typeof parsed?.height !== 'number') return null;
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
    return {
      width: Math.max(minWidth, parsed.width),
      height: Math.max(minHeight, parsed.height),
    };
  } catch {
    return null;
  }
}

/**
 * Lets the user drag a dialog to whatever size the content needs, and
 * remembers it.
 *
 * The size is driven by an explicit grip rather than CSS `resize`: Fluent's own
 * surface styles are injected after ours and reset both `resize` and `overflow`
 * on `DialogSurface`, and the native corner cannot be styled or made bigger
 * than the ~16px the browser draws.
 */
export function useResizableDialog(options: ResizableDialogOptions, open: boolean) {
  const { storageKey, minWidth, minHeight } = options;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<DialogSize | null>(null);

  // localStorage is read on open (not on mount) so a size stored elsewhere in
  // the same session is picked up too.
  useEffect(() => {
    if (open) setSize(readStoredDialogSize(options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, minWidth, minHeight, open]);

  const startResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const surface = surfaceRef.current;
    if (!surface || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const grip = event.currentTarget;
    const rect = surface.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = rect.width;
    const startH = rect.height;
    // A centred dialog only moves each edge by half of the size change —
    // without this the box drifts away from the cursor.
    const scaleX = Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < 8 ? 2 : 1;
    const scaleY = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) < 8 ? 2 : 1;

    let latest: DialogSize = { width: startW, height: startH };

    // A drag across the dialog would otherwise select every label it crosses.
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: PointerEvent) => {
      latest = {
        width: clampSize(startW + (moveEvent.clientX - startX) * scaleX, minWidth, window.innerWidth - 16),
        height: clampSize(startH + (moveEvent.clientY - startY) * scaleY, minHeight, window.innerHeight - 16),
      };
      setSize(latest);
    };

    const onUp = () => {
      document.body.style.userSelect = previousUserSelect;
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      try { grip.releasePointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ width: Math.round(latest.width), height: Math.round(latest.height) }),
        );
      } catch { /* private mode / quota — the size just won't persist */ }
    };

    grip.setPointerCapture(event.pointerId);
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  }, [storageKey, minWidth, minHeight]);

  /** Back to the default size — the escape hatch from a bad drag. */
  const resetSize = useCallback(() => {
    setSize(null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch { /* nothing stored to forget */ }
  }, [storageKey]);

  return { surfaceRef, size, startResize, resetSize };
}
