'use client';

import { createElement, useEffect, useState } from 'react';
import {
  THEME_ICONS,
  THEME_ICON_SVG_ATTRS,
  applyResolvedTheme,
  nextThemeMode,
  persistThemeMode,
  readThemeMode,
  resolveThemeMode,
  systemTheme,
  type ThemeMode,
} from '@er-visualizer/design-tokens/theme';

/**
 * The site's theme switch. The SPA renders the same control from the same
 * shared icons, class and cycle (`packages/ui/src/components/ThemeSwitch.tsx`);
 * only the surrounding framework differs. Change the appearance in
 * `design-tokens/theme.css`, not here.
 *
 * Both write the one localStorage key on this origin (the SPA is served from
 * `/app`), so a choice made on either side covers both.
 */

const LABELS: Record<ThemeMode, string> = {
  system: 'Follow system',
  light: 'Light',
  dark: 'Dark',
};

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  return (
    <svg {...THEME_ICON_SVG_ATTRS} aria-hidden>
      {THEME_ICONS[mode].map((shape, i) => createElement(shape.tag, { key: i, ...shape.attrs }))}
    </svg>
  );
}

export function ThemeSwitch() {
  const [mode, setMode] = useState<ThemeMode>('system');
  // The server cannot know the stored choice, so the first client render has to
  // match the server's (`system`) and only then correct itself — otherwise
  // React replaces the button mid-hydration.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMode(readThemeMode());
    setReady(true);
  }, []);

  // Keep following the OS while the mode is `system` — the SPA does the same,
  // and without this the page would only pick up an OS change on reload.
  useEffect(() => {
    if (mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyResolvedTheme(systemTheme());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  function cycle() {
    const next = nextThemeMode(mode);
    setMode(next);
    persistThemeMode(next);
    applyResolvedTheme(resolveThemeMode(next));
  }

  const label = `Theme: ${LABELS[mode]}`;

  return (
    <button type="button" className="er-theme-switch" onClick={cycle} aria-label={label} title={label}>
      {/* Until the stored mode is read, render the default icon rather than a
          blank box — the button keeps its size and the swap is invisible. */}
      <ThemeIcon mode={ready ? mode : 'system'} />
    </button>
  );
}
