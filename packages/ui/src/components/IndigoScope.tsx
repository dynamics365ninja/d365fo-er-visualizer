import type { CSSProperties, ReactNode } from 'react';
import { mergeClasses } from '@fluentui/react-components';
import { darkTheme } from './fluent-themes';

/**
 * Fluent's theme as custom properties: `--colorNeutralForeground1: var(--er-text)`
 * and so on. Declared on the scope's own element they resolve against its
 * re-pointed `--er-*` tokens.
 */
const indigoFluentVars = Object.fromEntries(
  Object.entries(darkTheme).map(([token, value]) => [`--${token}`, String(value)]),
) as CSSProperties;

/**
 * A part of the indigo chrome — the workspace sidebar with the explorer.
 *
 * `wb-indigo` (app-tokens.css) re-points the `--er-*` tokens to the palette on
 * indigo, which is enough for our own CSS. Fluent components read their own
 * variables, so the scope declares those again on its element (from the dark
 * theme, whose values are `var(--er-*)`): buttons, dividers and inputs inside
 * paint from the indigo tokens too. Not a nested FluentProvider: its portals
 * would carry the scope along, and the dialogs, menus and tooltips opened
 * from the sidebar belong to the light page.
 */
export function IndigoScope({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={mergeClasses('wb-indigo', className)} style={indigoFluentVars}>
      {children}
    </div>
  );
}
