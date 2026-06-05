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

const darkOverrides: Partial<Theme> = {
  colorNeutralBackground1: '#181a1f',
  colorNeutralBackground1Hover: '#202329',
  colorNeutralBackground2: '#202329',
  colorNeutralBackground3: '#252931',
  colorNeutralBackground4: '#2a2f39',
  colorNeutralStroke1: '#323844',
  colorNeutralStroke2: '#323844',
  colorBrandBackground: '#3f98ff',
  colorBrandBackgroundHover: '#57a7ff',
  colorBrandBackgroundPressed: '#307fd3',
  colorBrandBackground2: 'rgba(63, 152, 255, 0.2)',
  colorBrandForeground1: '#75beff',
  colorBrandForeground2: '#9dcfff',
  colorBrandStroke1: '#3f98ff',
  colorBrandStroke2: 'rgba(117, 190, 255, 0.42)',
  colorCompoundBrandBackground: '#3f98ff',
  colorCompoundBrandBackgroundHover: '#57a7ff',
  colorCompoundBrandStroke: '#3f98ff',
  fontFamilyBase: '"Segoe UI", "Segoe UI Variable", sans-serif',
  fontFamilyMonospace: '"Cascadia Code", Consolas, monospace',
  borderRadiusSmall: '4px',
  borderRadiusMedium: '6px',
  borderRadiusLarge: '8px',
};

const lightOverrides: Partial<Theme> = {
  colorNeutralBackground1: '#f8fafc',
  colorNeutralBackground2: '#f1f4f9',
  colorNeutralBackground3: '#e9edf4',
  colorNeutralBackground4: '#e1e7f1',
  colorNeutralStroke1: '#cdd5e3',
  colorNeutralStroke2: '#cdd5e3',
  colorBrandBackground: '#038387',
  colorBrandBackgroundHover: '#37a987',
  colorBrandBackgroundPressed: '#027578',
  colorBrandBackground2: 'rgba(3, 131, 135, 0.12)',
  colorBrandForeground1: '#038387',
  colorBrandForeground2: '#37a987',
  colorBrandStroke1: '#038387',
  colorBrandStroke2: 'rgba(3, 131, 135, 0.35)',
  colorCompoundBrandBackground: '#038387',
  colorCompoundBrandBackgroundHover: '#37a987',
  colorCompoundBrandStroke: '#038387',
  fontFamilyBase: '"Segoe UI", "Segoe UI Variable", sans-serif',
  fontFamilyMonospace: '"Cascadia Code", Consolas, monospace',
  borderRadiusSmall: '4px',
  borderRadiusMedium: '6px',
  borderRadiusLarge: '8px',
};

const darkTheme: Theme = { ...webDarkTheme, ...darkOverrides };
const lightTheme: Theme = { ...webLightTheme, ...lightOverrides };

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
