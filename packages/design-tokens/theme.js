/**
 * D365FO ER Visualizer — shared theme resolution.
 *
 * The JavaScript half of `tokens.css`. That file encodes the precedence in CSS
 * (`[data-theme]` → `prefers-color-scheme` → light); this one encodes the same
 * order for the two surfaces that have to agree on it:
 *   • packages/ui   — the SPA's theme switch
 *   • packages/site — the marketing site's switch and its <head> bootstrap
 *
 * Both write the same localStorage key on the same origin (the SPA is served
 * from `/app`), which is the whole point: a choice made on either side is the
 * choice on both. Keep this the only definition of the key and the mode names.
 *
 * Plain ESM on purpose — no build step in this package, so Vite and Next can
 * both import it directly. Types live in `theme.d.ts`.
 */

/* v2: the pre-v2 key stored a *resolved* 'dark'|'light' that the SPA rewrote on
   every toggle, so a long-forgotten click kept the app dark while the site,
   which only ever followed the OS, stayed light. v2 stores the preference and
   defaults to 'system'; the legacy key is deliberately not migrated. */
export const THEME_STORAGE_KEY = 'er-visualizer.themeMode.v2';

/** The switch cycles in this order. `system` first — it is the default. */
export const THEME_MODES = ['system', 'light', 'dark'];

export function isThemeMode(value) {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readThemeMode() {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function persistThemeMode(mode) {
  if (typeof window === 'undefined') return;
  try {
    // Following the OS is the default, so it is stored as the absence of a
    // choice — that way the default can change later without stale keys
    // pinning old users to it.
    if (mode === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory choice still applies for this page.
  }
}

/** The OS scheme — light unless the OS explicitly asks for dark, as in the CSS. */
export function systemTheme() {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveThemeMode(mode) {
  return mode === 'system' ? systemTheme() : mode;
}

/** Next mode in the cycle: system → light → dark → system. */
export function nextThemeMode(mode) {
  const index = THEME_MODES.indexOf(mode);
  return THEME_MODES[(index + 1) % THEME_MODES.length];
}

/**
 * Put the resolved theme on `<html>`. `data-theme` drives the tokens and both
 * stylesheets; `color-scheme` makes native controls and scrollbars follow.
 * Safe to call before a framework mounts.
 */
export function applyResolvedTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/* ── The switch itself ────────────────────────────────────────────────────────
   One control on both surfaces. The look lives in `theme.css` (class
   `er-theme-switch`, imported by the site's globals and the SPA's index.css);
   the geometry below is data rather than markup because the two render it with
   different frameworks — the SPA cannot use the site's JSX and vice versa.

   Shapes are `{ tag, attrs }` in SVG's own vocabulary, so a renderer is a
   one-line map over the array. Keep them at the 24×24 viewBox: the stroke width
   is tuned for it. */

export const THEME_ICON_SIZE = 18;

export const THEME_ICON_SVG_ATTRS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** Sun, moon, monitor — one per mode, matching THEME_MODES. */
export const THEME_ICONS = {
  system: [
    { tag: 'rect', attrs: { x: 2.5, y: 4, width: 19, height: 12.5, rx: 2 } },
    { tag: 'path', attrs: { d: 'M8.5 20.5h7M12 16.5v4' } },
  ],
  light: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } },
    {
      tag: 'path',
      attrs: {
        d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
      },
    },
  ],
  dark: [{ tag: 'path', attrs: { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' } }],
};

/**
 * Inline `<head>` script for server-rendered pages. Applies the stored choice
 * before first paint — running it after hydration would be a visible flash of
 * the other theme. Deliberately duplicates the tiny bit of logic above rather
 * than importing it, because it is stringified into the document.
 *
 * `system` writes nothing and lets the CSS media query decide.
 */
export const themeBootstrapScript = `try{var m=localStorage.getItem('${THEME_STORAGE_KEY}');if(m==='dark'||m==='light'){var r=document.documentElement;r.dataset.theme=m;r.style.colorScheme=m;}}catch(e){}`;
