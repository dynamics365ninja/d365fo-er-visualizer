import { createElement } from 'react';
import { useAppStore } from '../state/store';
import { THEME_ICONS, THEME_ICON_SVG_ATTRS, type ThemeMode } from '../theme';
import { t, useLocale } from '../i18n';

/**
 * The theme switch — the same control the marketing site renders
 * (`packages/site/components/ThemeSwitch.tsx`), from the same shared icons,
 * class and cycle. Only the label is translated; the site is English-only.
 *
 * A plain <button>, not a Fluent one, so both surfaces can share
 * `design-tokens/theme.css` verbatim instead of two lookalike styles drifting
 * apart. Change the appearance there.
 *
 * The button names the mode it is *in* rather than the one it would switch to:
 * with three modes there is no single "next" worth naming, and `system` has no
 * opposite.
 */

function modeLabel(mode: ThemeMode): string {
  if (mode === 'light') return t.lightTheme;
  if (mode === 'dark') return t.darkTheme;
  return t.systemTheme;
}

export function ThemeSwitch() {
  const themeMode = useAppStore(s => s.themeMode);
  const cycleTheme = useAppStore(s => s.cycleTheme);
  // `t` is a module-level binding swapped on locale change; subscribing keeps
  // the label from going stale when the language toggle is used.
  useLocale();

  const label = `${t.themeLabel}: ${modeLabel(themeMode)}`;

  return (
    <button
      type="button"
      className="er-theme-switch"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
    >
      <svg {...THEME_ICON_SVG_ATTRS} aria-hidden>
        {THEME_ICONS[themeMode].map((shape, i) =>
          createElement(shape.tag, { key: i, ...shape.attrs }),
        )}
      </svg>
    </button>
  );
}
