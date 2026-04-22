import {
  Button,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { DismissRegular, CompassNorthwestRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.colorNeutralStroke2,
    overflowX: 'auto',
    overflowY: 'hidden',
    minHeight: '32px',
  },
  tab: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '32px',
    maxWidth: '220px',
    paddingLeft: '12px',
    paddingRight: '30px',
    borderRadius: 0,
    borderRightWidth: '1px',
    borderRightStyle: 'solid',
    borderRightColor: tokens.colorNeutralStroke2,
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontSize: '12px',
    fontWeight: 400,
    cursor: 'pointer',
    userSelect: 'none',
    transitionProperty: 'background-color, color',
    transitionDuration: '120ms',
    transitionTimingFunction: 'ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      color: tokens.colorNeutralForeground1,
    },
  },
  tabActive: {
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '1px',
      backgroundColor: tokens.colorBrandStroke1,
    },
  },
  tabDrillDown: {
    fontStyle: 'italic',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    color: tokens.colorBrandForeground1,
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
      backgroundColor: tokens.colorNeutralBackground3Hover,
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
