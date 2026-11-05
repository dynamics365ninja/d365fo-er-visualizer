import { useEffect } from 'react';
import { FluentProvider } from '@fluentui/react-components';
import { useAppStore } from '../state/store';
import { applyResolvedTheme } from '../theme';
import { useLocale } from '../i18n';
import { App } from './App';
import { darkTheme, lightTheme } from './fluent-themes';

export function FluentRoot() {
  const resolvedTheme = useAppStore(s => s.resolvedTheme);
  const syncSystemTheme = useAppStore(s => s.syncSystemTheme);
  const rebuildDerivedState = useAppStore(s => s.rebuildDerivedState);
  const currentLocale = useLocale();
  const theme = resolvedTheme === 'dark' ? darkTheme : lightTheme;

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  // While the mode is `system`, follow the OS live — the marketing site does
  // the same through `prefers-color-scheme`, so the two never drift apart.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => syncSystemTheme();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [syncSystemTheme]);

  useEffect(() => {
    document.documentElement.lang = currentLocale;
    rebuildDerivedState();
  }, [currentLocale, rebuildDerivedState]);

  return (
    <FluentProvider theme={theme} style={{ width: '100%', height: '100%', background: 'transparent' }}>
      <App />
    </FluentProvider>
  );
}
