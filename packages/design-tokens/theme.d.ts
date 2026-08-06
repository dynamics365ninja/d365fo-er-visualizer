/** What the user picked. `system` (the default) tracks the OS colour scheme. */
export type ThemeMode = 'system' | 'light' | 'dark';
/** What actually gets painted — `system` resolved against `prefers-color-scheme`. */
export type ResolvedTheme = 'light' | 'dark';

export declare const THEME_STORAGE_KEY: string;
export declare const THEME_MODES: readonly ThemeMode[];

export declare function isThemeMode(value: unknown): value is ThemeMode;
export declare function readThemeMode(): ThemeMode;
export declare function persistThemeMode(mode: ThemeMode): void;
export declare function systemTheme(): ResolvedTheme;
export declare function resolveThemeMode(mode: ThemeMode): ResolvedTheme;
export declare function nextThemeMode(mode: ThemeMode): ThemeMode;
export declare function applyResolvedTheme(theme: ResolvedTheme): void;
export declare const themeBootstrapScript: string;

/** A shape in SVG's own vocabulary, ready to hand to a framework's element factory. */
export interface ThemeIconShape {
  tag: 'path' | 'rect' | 'circle';
  attrs: Record<string, string | number>;
}

export declare const THEME_ICON_SIZE: number;
export declare const THEME_ICON_SVG_ATTRS: Record<string, string | number>;
export declare const THEME_ICONS: Record<ThemeMode, ThemeIconShape[]>;
