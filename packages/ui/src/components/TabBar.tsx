import { useState } from 'react';
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import { DismissRegular, CompassNorthwestRegular, SplitVerticalRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { t, useLocale } from '../i18n';

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
    // 40px including the rule, so the bar lines up with the explorer header
    // and the right panel's tab strip either side of it.
    boxSizing: 'border-box',
    height: '40px',
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
  /** The tab shown in the side pane: marked, but quieter than the active one. */
  tabSide: {
    ...shorthands.borderColor('var(--er-accent-border)'),
    ...shorthands.borderStyle('dashed'),
    color: 'var(--er-text)',
  },
  tabDrillDown: {
    fontStyle: 'italic',
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flex: 1,
    minWidth: 0,
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
  },
  splitBtn: {
    flexShrink: 0,
    marginLeft: 'auto',
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
  const splitTabId = useAppStore(s => s.splitTabId);
  const openTabToSide = useAppStore(s => s.openTabToSide);
  const closeSplit = useAppStore(s => s.closeSplit);
  const [menu, setMenu] = useState<{ tabId: string; target: HTMLElement } | null>(null);
  useLocale(); // re-render on language change so aria labels stay localized

  if (tabs.length === 0) return null;

  const split = Boolean(splitTabId && splitTabId !== activeTabId);
  // Side by side starts with the tab the user was on before this one.
  const activeIndex = tabs.findIndex(tab => tab.id === activeTabId);
  const sideCandidate = tabs[activeIndex - 1] ?? tabs.find(tab => tab.id !== activeTabId);

  return (
    <div className={styles.root}>
      <div className={styles.tabs} role="tablist">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isSide = split && tab.id === splitTabId;
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
                isSide && styles.tabSide,
                isDrillDown && styles.tabDrillDown,
              )}
              onClick={() => setActiveTab(tab.id)}
              onContextMenu={e => {
                e.preventDefault();
                setMenu({ tabId: tab.id, target: e.currentTarget });
              }}
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
                aria-label={t.closeTab(tab.label)}
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
      {(split || sideCandidate) && (
        <Button
          appearance={split ? 'secondary' : 'subtle'}
          size="small"
          icon={<SplitVerticalRegular />}
          className={styles.splitBtn}
          aria-pressed={split}
          title={split ? t.splitClose : t.splitToggleHint}
          onClick={() => {
            if (split) closeSplit();
            else if (sideCandidate) openTabToSide(sideCandidate.id);
          }}
        >
          {t.splitToggle}
        </Button>
      )}
      <Menu
        open={menu !== null}
        onOpenChange={(_, data) => { if (!data.open) setMenu(null); }}
        positioning={{ target: menu?.target, position: 'below', align: 'start' }}
      >
        <MenuPopover>
          <MenuList>
            {menu && tabs.length > 1 && menu.tabId !== splitTabId && (
              <MenuItem icon={<SplitVerticalRegular />} onClick={() => openTabToSide(menu.tabId)}>
                {t.splitOpenBeside}
              </MenuItem>
            )}
            {split && (
              <MenuItem onClick={closeSplit}>{t.splitClose}</MenuItem>
            )}
            {menu && (
              <MenuItem icon={<DismissRegular />} onClick={() => closeTab(menu.tabId)}>
                {t.closeTab(tabs.find(tab => tab.id === menu.tabId)?.label ?? '')}
              </MenuItem>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
