import { useEffect } from 'react';
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  Toaster,
  type Theme,
} from '@fluentui/react-components';
import { useAppStore } from '../state/store';
import { App } from './App';

/**
 * Custom overrides to align Fluent's Web themes with the VS Code-like
 * aesthetic used throughout the app (dark editor background, accent blue).
 */
const darkOverrides: Partial<Theme> = {
  colorNeutralBackground1: '#1e1e1e',
  colorNeutralBackground2: '#252526',
  colorNeutralBackground3: '#2d2d30',
  colorNeutralBackground4: '#333333',
  colorNeutralStroke1: '#3c3c3c',
  colorNeutralStroke2: '#464647',
  colorBrandBackground: '#0e639c',
  colorBrandBackgroundHover: '#1177bb',
  colorBrandBackgroundPressed: '#0a4d78',
  colorCompoundBrandBackground: '#0e639c',
  colorCompoundBrandStroke: '#0e639c',
};

const lightOverrides: Partial<Theme> = {
  colorBrandBackground: '#0e639c',
  colorBrandBackgroundHover: '#1177bb',
  colorBrandBackgroundPressed: '#0a4d78',
};

const darkTheme: Theme = { ...webDarkTheme, ...darkOverrides };
const lightTheme: Theme = { ...webLightTheme, ...lightOverrides };

export const TOASTER_ID = 'er-visualizer-toaster';

export function FluentRoot() {
  const themeMode = useAppStore(s => s.themeMode);
  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  return (
    <FluentProvider theme={theme} style={{ width: '100%', height: '100%', background: 'transparent' }}>
      <App />
      <Toaster toasterId={TOASTER_ID} position="bottom-end" />
    </FluentProvider>
  );
}
