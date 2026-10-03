import { useState } from 'react';
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import { DismissRegular, DismissSquareMultipleRegular, CompassNorthwestRegular, SplitVerticalRegular } from '@fluentui/react-icons';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, isSplitView, tabsInPane, type DesignerPane } from '../state/store';
import { t, useLocale } from '../i18n';
import { draggedTabId, isTabDrag, startTabDrag } from '../utils/tab-drag';

const useStyles = makeStyles({
  // VS Code editor tab strip: the strip is chrome, the active tab is cut
  // from the editor below it (same ground, no rule underneath) and carries
  // a line along its top edge.
  root: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 0,
    padding: 0,
    backgroundColor: 'var(--er-chrome)',
    // An inset rule instead of a border, so the active tab can paint over it.
    boxShadow: 'inset 0 -1px 0 var(--er-border)',
    overflowX: 'auto',
    overflowY: 'hidden',
    boxSizing: 'border-box',
    height: 'var(--wb-header-h)',
    minHeight: 'var(--wb-header-h)',
  },
  tab: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '100%',
    maxWidth: '240px',
    paddingLeft: '12px',
    paddingRight: '30px',
    borderRadius: 0,
    border: 'none',
    borderRight: '1px solid var(--er-border)',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontSize: 'var(--er-text-md)',
    fontWeight: 400,
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    transitionProperty: 'color',
    transitionDuration: 'var(--er-duration-fast)',
    '&:hover': {
      color: 'var(--er-text)',
    },
  },
  tabActive: {
    backgroundColor: 'var(--er-bg-soft)',
    color: 'var(--er-text)',
    boxShadow: 'inset 0 1px 0 var(--er-accent-fill)',
    '&:hover': {
      color: 'var(--er-text)',
    },
  },
  /** The tab on screen in the group without focus: marked, but quieter than the focused one. */
  tabSide: {
    backgroundColor: 'var(--er-bg-soft)',
    boxShadow: 'inset 0 1px 0 var(--er-border-strong)',
    color: 'var(--er-text)',
  },
  tabDrillDown: {
    fontStyle: 'italic',
  },
  tabDragging: {
    opacity: 0.5,
  },
  /* Where a tab dragged along the strip lands: before or after this one. */
  dropBefore: {
    boxShadow: 'inset 2px 0 0 var(--er-accent)',
  },
  dropAfter: {
    boxShadow: 'inset -2px 0 0 var(--er-accent)',
  },
  tabs: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 0,
    flex: 1,
    minWidth: 0,
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
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
  groupClose: {
    alignSelf: 'center',
    margin: '0 2px',
    flexShrink: 0,
    minWidth: '24px',
    width: '24px',
    height: '24px',
    padding: 0,
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

/**
 * The tab strip of one group of the designer. Every group has its own, as in
 * an IDE: a tab dragged onto another group's strip (or into its content)
 * moves into that group.
 */
export function TabStrip({ pane }: { pane: DesignerPane }) {
  const styles = useStyles();
  const tabs = useAppStore(useShallow(s => tabsInPane(s, pane)));
  const shownTabId = useAppStore(s => (pane === 'side' ? s.splitTabId : s.activeTabId));
  const split = useAppStore(isSplitView);
  const groupFocused = useAppStore(s => !isSplitView(s) || s.focusedPane === pane);
  const mainTabCount = useAppStore(s => tabsInPane(s, 'main').length);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const closeTab = useAppStore(s => s.closeTab);
  const closeAllTabs = useAppStore(s => s.closeAllTabs);
  const moveTabToPane = useAppStore(s => s.moveTabToPane);
  const reorderTab = useAppStore(s => s.reorderTab);
  const closePane = useAppStore(s => s.closePane);
  const draggingTabId = useAppStore(s => s.draggingTabId);
  const setDraggingTab = useAppStore(s => s.setDraggingTab);
  const [menu, setMenu] = useState<{ tabId: string; target: HTMLElement } | null>(null);
  const [dropHint, setDropHint] = useState<{ tabId: string; after: boolean } | null>(null);
  useLocale(); // re-render on language change so aria labels stay localized

  if (tabs.length === 0) return null;

  const otherPane: DesignerPane = pane === 'main' ? 'side' : 'main';
  // Dropped here from the other group: join this one, then take the spot.
  const dropInto = (id: string, beforeId: string | null) => {
    if (useAppStore.getState().sideTabIds.includes(id) !== (pane === 'side')) moveTabToPane(id, pane);
    reorderTab(id, beforeId);
    setDropHint(null);
  };

  return (
    <div className={styles.root}>
      <div
        className={styles.tabs}
        role="tablist"
        onDragOver={e => { if (isTabDrag(e)) e.preventDefault(); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint(null); }}
        onDrop={e => {
          // Past the last tab: to the end of the strip.
          const id = draggedTabId(e);
          if (!id) return;
          e.preventDefault();
          dropInto(id, null);
        }}
      >
        {tabs.map((tab, index) => {
          const shown = tab.id === shownTabId;
          const isDrillDown = tab.kind === 'drillDown';
          const hint = dropHint?.tabId === tab.id ? dropHint : null;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={shown}
              tabIndex={0}
              draggable
              className={mergeClasses(
                styles.tab,
                shown && (groupFocused ? styles.tabActive : styles.tabSide),
                isDrillDown && styles.tabDrillDown,
                draggingTabId === tab.id && styles.tabDragging,
                hint ? (hint.after ? styles.dropAfter : styles.dropBefore) : undefined,
              )}
              onDragStart={e => {
                startTabDrag(e, tab.id);
                setDraggingTab(tab.id);
              }}
              onDragEnd={() => {
                setDraggingTab(null);
                setDropHint(null);
              }}
              onDragOver={e => {
                if (!isTabDrag(e)) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > rect.left + rect.width / 2;
                if (hint?.after !== after) setDropHint({ tabId: tab.id, after });
              }}
              onDrop={e => {
                const id = draggedTabId(e);
                if (!id) return;
                e.preventDefault();
                e.stopPropagation();
                dropInto(id, hint?.after ? (tabs[index + 1]?.id ?? null) : tab.id);
              }}
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
      {tabs.length > 1 && (
        <Button
          appearance="subtle"
          size="small"
          icon={<DismissSquareMultipleRegular />}
          className={styles.groupClose}
          title={t.closeAllTabs}
          aria-label={t.closeAllTabs}
          onClick={closeAllTabs}
        />
      )}
      {split && (
        <Button
          appearance="subtle"
          size="small"
          icon={<DismissRegular />}
          className={styles.groupClose}
          title={pane === 'side' ? t.splitCloseSideGroup : t.splitCloseMainGroup}
          aria-label={pane === 'side' ? t.splitCloseSideGroup : t.splitCloseMainGroup}
          onClick={() => closePane(pane)}
        />
      )}
      <Menu
        open={menu !== null}
        onOpenChange={(_, data) => { if (!data.open) setMenu(null); }}
        positioning={{ target: menu?.target, position: 'below', align: 'start' }}
      >
        <MenuPopover>
          <MenuList>
            {menu && (pane === 'side' || mainTabCount > 1) && (
              <MenuItem icon={<SplitVerticalRegular />} onClick={() => moveTabToPane(menu.tabId, otherPane)}>
                {!split ? t.splitOpenBeside : otherPane === 'main' ? t.splitMoveLeft : t.splitMoveRight}
              </MenuItem>
            )}
            {menu && (
              <MenuItem icon={<DismissRegular />} onClick={() => closeTab(menu.tabId)}>
                {t.closeTab(tabs.find(tab => tab.id === menu.tabId)?.label ?? '')}
              </MenuItem>
            )}
            {menu && tabs.length > 1 && (
              <MenuItem
                icon={<DismissSquareMultipleRegular />}
                onClick={() => tabs.filter(tab => tab.id !== menu.tabId).forEach(tab => closeTab(tab.id))}
              >
                {t.closeOtherTabs}
              </MenuItem>
            )}
            {menu && (
              <MenuItem icon={<DismissSquareMultipleRegular />} onClick={closeAllTabs}>
                {t.closeAllTabs}
              </MenuItem>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
