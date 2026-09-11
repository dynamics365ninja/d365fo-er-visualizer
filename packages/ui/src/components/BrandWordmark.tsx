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
    fontSize: '9.5px',
    fontWeight: 700,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'var(--er-text-subtle)',
  },
  rule: {
    width: '1px',
    height: '14px',
    backgroundColor: 'var(--er-border-strong)',
  },
  name: {
    fontFamily: 'var(--er-font-display)',
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '-0.01em',
    // The three configuration hues the whole app is colour-coded by, read
    // left to right the way a configuration flows: model → mapping → format.
    backgroundImage: 'linear-gradient(100deg, var(--er-model), var(--er-mapping) 55%, var(--er-format))',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
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
