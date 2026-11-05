import type { SVGProps } from 'react';

/**
 * The three configuration kinds as the Indigo Ledger design draws them: a
 * database for the data model, two opposed arrows for the model mapping, a
 * document with lines for the format. One definition for every place a kind
 * is shown — explorer, tabs, inspector, search, recent work — so they cannot
 * drift apart again.
 *
 * Stroke icons on a 24 grid that take their colour from the text, sized in
 * pixels by `fontSize` like the Fluent icons they sit next to.
 */

type ConfigKind = 'DataModel' | 'ModelMapping' | 'Format';

interface KindIconProps extends Omit<SVGProps<SVGSVGElement>, 'fontSize'> {
  fontSize?: number;
}

function KindSvg({ fontSize = 16, children, ...rest }: KindIconProps) {
  return (
    <svg
      width={fontSize}
      height={fontSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ModelKindIcon(props: KindIconProps) {
  return (
    <KindSvg {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </KindSvg>
  );
}

export function MappingKindIcon(props: KindIconProps) {
  return (
    <KindSvg {...props}>
      <path d="M4 7h11" />
      <path d="m12 4 3 3-3 3" />
      <path d="M20 17H9" />
      <path d="m12 14-3 3 3 3" />
    </KindSvg>
  );
}

export function FormatKindIcon(props: KindIconProps) {
  return (
    <KindSvg {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </KindSvg>
  );
}

/** The icon of a configuration kind; anything unknown is drawn as a format. */
export function ConfigKindIcon({ kind, ...props }: KindIconProps & { kind: ConfigKind | string | undefined }) {
  if (kind === 'DataModel') return <ModelKindIcon {...props} />;
  if (kind === 'ModelMapping') return <MappingKindIcon {...props} />;
  return <FormatKindIcon {...props} />;
}
