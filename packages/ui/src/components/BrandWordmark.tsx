import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { t } from '../i18n';

const useStyles = makeStyles({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    whiteSpace: 'nowrap',
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

/** "D365FO | ER Visualizer" — the wordmark shared by the toolbar and the landing page. */
export function BrandWordmark({ className }: { className?: string }) {
  const styles = useStyles();
  return (
    <span className={mergeClasses(styles.root, className)}>
      <span className={styles.vendor}>D365FO</span>
      <span className={styles.rule} />
      <span className={styles.name}>{t.appName}</span>
    </span>
  );
}
