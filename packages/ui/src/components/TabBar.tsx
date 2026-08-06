import {
  Button,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import { DismissRegular, CompassNorthwestRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 8px',
    backgroundColor: 'var(--er-surface)',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--er-border)',
    overflowX: 'auto',
    overflowY: 'hidden',
    minHeight: '40px',
  },
  tab: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '28px',
    maxWidth: '240px',
    paddingLeft: '11px',
    paddingRight: '28px',
    borderRadius: 'var(--er-radius-md)',
    ...shorthands.border('1px', 'solid', 'transparent'),
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    transitionProperty: 'background-color, color, border-color',
    transitionDuration: '120ms',
    '&:hover': {
      backgroundColor: 'var(--er-surface-2)',
      color: 'var(--er-text)',
    },
  },
  tabActive: {
    backgroundColor: 'var(--er-accent-soft)',
    ...shorthands.borderColor('var(--er-accent-border)'),
    color: 'var(--er-accent)',
    fontWeight: 600,
    '&:hover': {
      backgroundColor: 'var(--er-accent-soft)',
      color: 'var(--er-accent)',
    },
  },
  tabDrillDown: {
    fontStyle: 'italic',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'currentColor',
  },
  label: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
  },
  closeBtn: {
    position: 'absolute',
    right: '4px',
    top: '50%',
    transform: 'translateY(-50%)',
    minWidth: '20px',
    width: '20px',
    height: '20px',
    padding: 0,
    opacity: 0.6,
    '&:hover': {
      opacity: 1,
      backgroundColor: 'var(--er-surface-3)',
    },
  },
});

export function TabBar() {
  const styles = useStyles();
  const tabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const closeTab = useAppStore(s => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className={styles.root} role="tablist">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const isDrillDown = tab.kind === 'drillDown';
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            className={mergeClasses(
              styles.tab,
              isActive && styles.tabActive,
              isDrillDown && styles.tabDrillDown,
            )}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActiveTab(tab.id);
              }
            }}
            title={tab.label}
          >
            {isDrillDown && (
              <span className={styles.icon} aria-hidden>
                <CompassNorthwestRegular fontSize={13} />
              </span>
            )}
            <span className={styles.label}>{tab.label}</span>
            <Button
              appearance="transparent"
              size="small"
              icon={<DismissRegular />}
              aria-label={`Close ${tab.label}`}
              className={styles.closeBtn}
              onClick={e => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
