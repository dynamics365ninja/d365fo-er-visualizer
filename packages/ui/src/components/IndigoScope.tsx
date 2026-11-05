import type { ReactNode } from 'react';
import { FluentProvider, mergeClasses } from '@fluentui/react-components';
import { darkTheme } from './fluent-themes';

/**
 * A part of the indigo chrome — the top bar, the explorer, the status bar.
 *
 * `wb-indigo` (app-tokens.css) re-points the `--er-*` tokens to the dark
 * palette on indigo, which is enough for our own CSS. Fluent components read
 * their own variables, resolved once where their provider sits; a provider
 * here declares them again inside the scope, so the buttons, dividers and
 * inputs in it paint from the indigo tokens too. Popups (menus, tooltips,
 * popovers) mount outside the scope and keep the page's colours.
 */
export function IndigoScope({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <FluentProvider theme={darkTheme} className={mergeClasses('wb-indigo', className)}>
      {children}
    </FluentProvider>
  );
}
