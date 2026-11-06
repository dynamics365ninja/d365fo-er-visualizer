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
  // Buttons, menu items and options light up in the one hover tint the
  // app's own rows use.
  colorNeutralBackground1Hover: 'var(--er-hover)',
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
  colorNeutralForeground1Hover: 'var(--er-text)',
  colorNeutralForeground1Pressed: 'var(--er-text)',
  colorNeutralForeground1Selected: 'var(--er-text)',
  colorNeutralForeground2: 'var(--er-text-muted)',
  colorNeutralForeground2Hover: 'var(--er-text)',
  colorNeutralForeground2Pressed: 'var(--er-text)',
  colorNeutralForeground2Selected: 'var(--er-text)',
  // A subtle button's icon turned Fluent's own blue on hover; now the accent.
  colorNeutralForeground2BrandHover: 'var(--er-accent)',
  colorNeutralForeground2BrandPressed: 'var(--er-accent-hover)',
  colorNeutralForeground2BrandSelected: 'var(--er-accent)',
  colorNeutralForeground3: 'var(--er-text-subtle)',
  colorNeutralForeground3Hover: 'var(--er-text-muted)',
  colorNeutralForeground3Pressed: 'var(--er-text-muted)',
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
  colorBrandForegroundLink: 'var(--er-accent)',
  colorBrandForegroundLinkHover: 'var(--er-accent-hover)',
  colorBrandForegroundLinkPressed: 'var(--er-accent-active)',
  colorCompoundBrandForeground1: 'var(--er-accent-fill)',
  colorCompoundBrandForeground1Hover: 'var(--er-accent-fill-hover)',
  colorCompoundBrandForeground1Pressed: 'var(--er-accent-fill)',
  colorBrandStroke1: 'var(--er-accent-fill)',
  colorBrandStroke2: 'var(--er-accent-border)',
  colorCompoundBrandBackground: 'var(--er-accent-fill)',
  colorCompoundBrandBackgroundHover: 'var(--er-accent-fill-hover)',
  colorCompoundBrandStroke: 'var(--er-accent-fill)',
  colorCompoundBrandStrokeHover: 'var(--er-accent-fill-hover)',
  colorNeutralForegroundOnBrand: 'var(--er-on-accent-fill)',
  colorStrokeFocus2: 'var(--er-accent-fill)',
  // States: message bars, validation text and tinted badges take the app's
  // soft state boxes instead of Fluent's own reds, greens and yellows.
  colorStatusSuccessBackground1: 'var(--er-success-soft)',
  colorStatusSuccessBorder1: 'var(--er-success-border)',
  colorStatusSuccessForeground1: 'var(--er-success)',
  colorStatusWarningBackground1: 'var(--er-warning-soft)',
  colorStatusWarningBorder1: 'var(--er-warning-border)',
  colorStatusWarningForeground1: 'var(--er-warning)',
  colorStatusWarningForeground3: 'var(--er-warning)',
  colorStatusDangerBackground1: 'var(--er-danger-soft)',
  colorStatusDangerBorder1: 'var(--er-danger-border)',
  colorStatusDangerForeground1: 'var(--er-danger)',
  colorPaletteRedForeground1: 'var(--er-danger)',
  colorPaletteRedBackground1: 'var(--er-danger-soft)',
  colorPaletteRedBorder1: 'var(--er-danger-border)',
  colorPaletteRedBorder2: 'var(--er-danger)',
  colorPaletteRedBorderActive: 'var(--er-danger)',
  colorPaletteGreenForeground1: 'var(--er-success)',
  colorPaletteGreenBackground1: 'var(--er-success-soft)',
  colorPaletteGreenBorder1: 'var(--er-success-border)',
  colorPaletteYellowForeground1: 'var(--er-warning)',
  colorPaletteYellowBorderActive: 'var(--er-warning)',
  colorPaletteDarkOrangeForeground1: 'var(--er-warning)',
  // The dialog backdrop is the app's scrim.
  colorBackgroundOverlay: 'var(--er-scrim)',
  // Ledger elevation: cards lie flat (1), popovers and menus float (2),
  // dialogs stand above everything (3).
  shadow2: 'var(--er-shadow-1)',
  shadow4: 'var(--er-shadow-1)',
  shadow8: 'var(--er-shadow-2)',
  shadow16: 'var(--er-shadow-2)',
  shadow28: 'var(--er-shadow-3)',
  shadow64: 'var(--er-shadow-3)',
  shadow2Brand: 'var(--er-shadow-1)',
  shadow4Brand: 'var(--er-shadow-1)',
  shadow8Brand: 'var(--er-shadow-2)',
  shadow16Brand: 'var(--er-shadow-2)',
  shadow28Brand: 'var(--er-shadow-3)',
  shadow64Brand: 'var(--er-shadow-3)',
  fontSizeBase100: 'var(--er-text-xs)',
  fontSizeBase200: 'var(--er-text-sm)',
  fontSizeBase300: 'var(--er-text-md)',
  fontFamilyBase: 'var(--er-font-sans)',
  fontFamilyMonospace: 'var(--er-font-mono)',
  // One step rounder than Fluent's scale: controls, buttons and menus get the
  // Ledger's 9px, small parts 6px, dialogs 16px.
  borderRadiusSmall: 'var(--er-radius-md)',
  borderRadiusMedium: 'var(--er-radius-lg)',
  borderRadiusLarge: 'var(--er-radius-xl)',
  borderRadiusXLarge: '16px',
};

export const darkTheme: Theme = { ...webDarkTheme, ...sharedOverrides };
export const lightTheme: Theme = { ...webLightTheme, ...sharedOverrides };
