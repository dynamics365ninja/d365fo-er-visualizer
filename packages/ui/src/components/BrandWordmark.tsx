import { useId } from 'react';
import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { t } from '../i18n';

const useStyles = makeStyles({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    whiteSpace: 'nowrap',
  },
  mark: {
    width: '18px',
    height: '18px',
    flexShrink: 0,
  },
  vendor: {
    fontSize: 'var(--er-text-xs)',
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: 'var(--er-text-subtle)',
  },
  rule: {
    width: '1px',
    height: '12px',
    backgroundColor: 'var(--er-border-strong)',
  },
  // Plain text, the way VS Code titles its window: the colour-coding belongs
  // to the configurations, not to the app's name.
  name: {
    fontSize: 'var(--er-text-md)',
    fontWeight: 600,
    color: 'var(--er-text)',
  },
});

/**
 * The "ER" mark of `favicon.svg` and the marketing site's logo — keep the three
 * in step. The gradient reads the theme's configuration hues, so it follows the
 * theme switch.
 */
export function BrandMark({ className }: { className?: string }) {
  // Two wordmarks can be on screen at once (landing page and toolbar).
  const gradientId = `brand-er-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="10 9 46 46" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="13" y1="26" x2="53" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--er-model)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--er-mapping)' }} />
          <stop offset="1" style={{ stopColor: 'var(--er-format)' }} />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradientId})`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M28 19H16v26h12M16 32h10" />
        <path d="M36 45V19h7a7 7 0 0 1 0 14h-7m6 0 7 12" />
      </g>
    </svg>
  );
}

/**
 * "D365FO | ER Visualizer" in the workspace toolbar. `short` is the landing
 * page's variant: the "ER" mark with "D365FO", since the hero right below
 * spells the name out as the large logo. The full form leaves the mark out, or
 * "ER" would stand twice in a row.
 */
export function BrandWordmark({ className, short = false }: { className?: string; short?: boolean }) {
  const styles = useStyles();
  return (
    <span className={mergeClasses(styles.root, className)}>
      {short && <BrandMark className={styles.mark} />}
      <span className={styles.vendor}>D365FO</span>
      {!short && (
        <>
          <span className={styles.rule} />
          <span className={styles.name}>{t.appName}</span>
        </>
      )}
    </span>
  );
}
