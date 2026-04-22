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
    alignItems: 'flex-end',
    gap: '2px',
    paddingLeft: '8px',
    paddingRight: '8px',
    paddingTop: '4px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.colorNeutralStroke2,
    overflowX: 'auto',
    overflowY: 'hidden',
    minHeight: '38px',
  },
  tab: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '30px',
    maxWidth: '220px',
    paddingLeft: '12px',
    paddingRight: '30px',
    borderTopLeftRadius: '10px',
    borderTopRightRadius: '10px',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    userSelect: 'none',
    transitionProperty: 'background-color, color, transform',
    transitionDuration: '140ms',
    transitionTimingFunction: 'ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2,
      color: tokens.colorNeutralForeground1,
    },
  },
  tabActive: {
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: `0 -1px 0 ${tokens.colorBrandStroke1} inset, 1px -1px 0 ${tokens.colorNeutralStroke2}, -1px -1px 0 ${tokens.colorNeutralStroke2}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '2px',
      backgroundImage: `linear-gradient(90deg, ${tokens.colorBrandBackground}, ${tokens.colorBrandBackground2 ?? tokens.colorBrandBackgroundHover})`,
      borderTopLeftRadius: '10px',
      borderTopRightRadius: '10px',
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
