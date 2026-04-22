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
 * Custom overrides aligning Fluent with the awesome-sharepoint inspired
 * brand palette (teal #038387 → deep teal #005b70, accent green #37a987).
 */
const darkOverrides: Partial<Theme> = {
  colorNeutralBackground1: '#0f1419',
  colorNeutralBackground1Hover: '#161c23',
  colorNeutralBackground2: '#131920',
  colorNeutralBackground3: '#171e25',
  colorNeutralBackground4: '#1c242c',
  colorNeutralStroke1: '#2a3440',
  colorNeutralStroke2: '#222b35',
  colorBrandBackground: '#038387',
  colorBrandBackgroundHover: '#05a2a7',
  colorBrandBackgroundPressed: '#005b70',
  colorBrandBackground2: 'rgba(3, 131, 135, 0.16)',
  colorBrandForeground1: '#2dcfd3',
  colorBrandForeground2: '#58e0e3',
  colorBrandStroke1: '#05a2a7',
  colorBrandStroke2: 'rgba(3, 131, 135, 0.4)',
  colorCompoundBrandBackground: '#038387',
  colorCompoundBrandBackgroundHover: '#05a2a7',
  colorCompoundBrandStroke: '#05a2a7',
};

const lightOverrides: Partial<Theme> = {
  colorBrandBackground: '#038387',
  colorBrandBackgroundHover: '#02696d',
  colorBrandBackgroundPressed: '#005b70',
  colorBrandBackground2: 'rgba(3, 131, 135, 0.08)',
  colorBrandForeground1: '#027578',
  colorBrandForeground2: '#038387',
  colorBrandStroke1: '#038387',
  colorBrandStroke2: 'rgba(3, 131, 135, 0.4)',
  colorCompoundBrandBackground: '#038387',
  colorCompoundBrandBackgroundHover: '#02696d',
  colorCompoundBrandStroke: '#038387',
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
