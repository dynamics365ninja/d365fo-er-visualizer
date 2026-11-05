import { webLightTheme, webDarkTheme, type Theme } from '@fluentui/react-components';

/**
 * Fluent reads these as raw CSS values, so pointing them at the shared
 * `--er-*` custom properties keeps one palette for Fluent components, our own
 * CSS, and the marketing site — and makes them flip with `data-theme` for free.
 * The previous overrides drifted apart (teal in light, blue in dark); don't
 * reintroduce literal hexes here.
 */
const sharedOverrides: Partial<Theme> = {
  colorNeutralBackground1: 'var(--er-surface)',
  colorNeutralBackground1Hover: 'var(--er-surface-3)',
  colorNeutralBackground1Pressed: 'var(--er-selected)',
  colorNeutralBackground2: 'var(--er-bg-soft)',
  colorNeutralBackground2Hover: 'var(--er-surface-3)',
  colorNeutralBackground3: 'var(--er-surface-2)',
  colorNeutralBackground3Hover: 'var(--er-surface-3)',
  colorNeutralBackground4: 'var(--er-surface-3)',
  colorNeutralStroke1: 'var(--er-input-border)',
  colorNeutralStroke1Hover: 'var(--er-border-strong)',
  colorNeutralStroke1Pressed: 'var(--er-border-strong)',
  colorNeutralStroke2: 'var(--er-border)',
  colorNeutralStroke3: 'var(--er-border)',
  // One even border on inputs; Fluent's darker bottom edge is what made the
  // fields look like a different toolkit from the rest of the app.
  colorNeutralStrokeAccessible: 'var(--er-input-border)',
  colorNeutralStrokeAccessibleHover: 'var(--er-border-strong)',
  colorNeutralStrokeAccessiblePressed: 'var(--er-border-strong)',
  colorNeutralForeground1: 'var(--er-text)',
  colorNeutralForeground2: 'var(--er-text-muted)',
  colorNeutralForeground3: 'var(--er-text-subtle)',
  colorSubtleBackgroundHover: 'var(--er-hover)',
  colorSubtleBackgroundPressed: 'var(--er-surface-3)',
  colorSubtleBackgroundSelected: 'var(--er-selected)',
  // Filled buttons use the workbench's fill; `--er-accent` stays the text/link
  // colour, which in dark is lighter than a fill can be.
  colorBrandBackground: 'var(--er-accent-fill)',
  colorBrandBackgroundHover: 'var(--er-accent-fill-hover)',
  colorBrandBackgroundPressed: 'var(--er-accent-fill)',
  colorBrandBackground2: 'var(--er-accent-soft)',
  colorBrandForeground1: 'var(--er-accent)',
  colorBrandForeground2: 'var(--er-accent-hover)',
  colorBrandStroke1: 'var(--er-accent-fill)',
  colorBrandStroke2: 'var(--er-accent-border)',
  colorCompoundBrandBackground: 'var(--er-accent-fill)',
  colorCompoundBrandBackgroundHover: 'var(--er-accent-fill-hover)',
  colorCompoundBrandStroke: 'var(--er-accent-fill)',
  colorCompoundBrandStrokeHover: 'var(--er-accent-fill-hover)',
  colorNeutralForegroundOnBrand: 'var(--er-on-accent-fill)',
  colorStrokeFocus2: 'var(--er-accent-fill)',
  fontSizeBase100: 'var(--er-text-xs)',
  fontSizeBase200: 'var(--er-text-sm)',
  fontSizeBase300: 'var(--er-text-md)',
  fontFamilyBase: 'var(--er-font-sans)',
  fontFamilyMonospace: 'var(--er-font-mono)',
  borderRadiusSmall: 'var(--er-radius-sm)',
  borderRadiusMedium: 'var(--er-radius-md)',
  borderRadiusLarge: 'var(--er-radius-lg)',
  borderRadiusXLarge: 'var(--er-radius-xl)',
};

export const darkTheme: Theme = { ...webDarkTheme, ...sharedOverrides };
export const lightTheme: Theme = { ...webLightTheme, ...sharedOverrides };
