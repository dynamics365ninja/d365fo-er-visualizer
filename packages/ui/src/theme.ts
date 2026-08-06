/**
 * Theme resolution for the SPA.
 *
 * The rules themselves live in `@er-visualizer/design-tokens/theme`, next to
 * the CSS that encodes the same precedence — the marketing site imports that
 * very module, so the two surfaces cannot disagree about the storage key, the
 * mode names, or what `system` resolves to.
 *
 * This file only re-exports, so `main.tsx` can paint the right theme before the
 * store chunk is fetched without reaching across packages in three places.
 */

export {
  THEME_ICONS,
  THEME_ICON_SIZE,
  THEME_ICON_SVG_ATTRS,
  THEME_MODES,
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  nextThemeMode,
  persistThemeMode,
  readThemeMode,
  resolveThemeMode,
  systemTheme,
  type ResolvedTheme,
  type ThemeMode,
} from '@er-visualizer/design-tokens/theme';
