import { useEffect } from 'react';
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  Toaster,
  type Theme,
} from '@fluentui/react-components';
import { useAppStore } from '../state/store';
import { useLocale } from '../i18n';
import { App } from './App';

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
  colorNeutralStroke1: 'var(--er-border-strong)',
  colorNeutralStroke2: 'var(--er-border)',
  colorNeutralStroke3: 'var(--er-border)',
  colorNeutralForeground1: 'var(--er-text)',
  colorNeutralForeground2: 'var(--er-text-muted)',
  colorNeutralForeground3: 'var(--er-text-subtle)',
  colorSubtleBackgroundSelected: 'var(--er-selected)',
  colorBrandBackground: 'var(--er-accent)',
  colorBrandBackgroundHover: 'var(--er-accent-hover)',
  colorBrandBackgroundPressed: 'var(--er-accent-active)',
  colorBrandBackground2: 'var(--er-accent-soft)',
  colorBrandForeground1: 'var(--er-accent)',
  colorBrandForeground2: 'var(--er-accent-hover)',
  colorBrandStroke1: 'var(--er-accent)',
  colorBrandStroke2: 'var(--er-accent-border)',
  colorCompoundBrandBackground: 'var(--er-accent)',
  colorCompoundBrandBackgroundHover: 'var(--er-accent-hover)',
  colorCompoundBrandStroke: 'var(--er-accent)',
  colorNeutralForegroundOnBrand: 'var(--er-accent-contrast)',
  fontFamilyBase: 'var(--er-font-sans)',
  fontFamilyMonospace: 'var(--er-font-mono)',
  borderRadiusSmall: 'var(--er-radius-sm)',
  borderRadiusMedium: 'var(--er-radius-md)',
  borderRadiusLarge: 'var(--er-radius-lg)',
  borderRadiusXLarge: 'var(--er-radius-xl)',
};

const darkTheme: Theme = { ...webDarkTheme, ...sharedOverrides };
const lightTheme: Theme = { ...webLightTheme, ...sharedOverrides };

export const TOASTER_ID = 'er-visualizer-toaster';

export function FluentRoot() {
  const themeMode = useAppStore(s => s.themeMode);
  const rebuildDerivedState = useAppStore(s => s.rebuildDerivedState);
  const currentLocale = useLocale();
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.lang = currentLocale;
    rebuildDerivedState();
  }, [currentLocale, rebuildDerivedState]);

  return (
    <FluentProvider theme={theme} style={{ width: '100%', height: '100%', background: 'transparent' }}>
      <App />
      <Toaster toasterId={TOASTER_ID} position="bottom-end" />
    </FluentProvider>
  );
}
