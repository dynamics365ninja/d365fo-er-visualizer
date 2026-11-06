import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  makeStyles,
  tokens,
  mergeClasses,
  Button,
  Tooltip,
  Popover,
  PopoverTrigger,
  PopoverSurface,
  Caption1,
  Caption1Strong,
  Body1Strong,
} from '@fluentui/react-components';
import {
  ExpandUpRightRegular,
  ArrowMinimizeRegular,
  ArrowSyncRegular,
  DismissRegular,
  LinkRegular,
  WarningRegular,
  CheckmarkCircleRegular,
  SearchRegular,
  AppsListDetailRegular,
} from '@fluentui/react-icons';
import { useAppStore, focusedTabId } from '../state/store';
import {
  loadPanelVisibility,
  panelGroupSaveId,
  savePanelVisibility,
  type PanelVisibility,
  type SidePanelTab,
} from '../utils/ui-preferences';
import { ConfigExplorer } from './ConfigExplorer';
import { PropertyInspector } from './PropertyInspector';
import { Toolbar } from './Toolbar';
import { ModelKindIcon } from './KindIcons';

/**
 * Split at the workspace boundary: the designer pulls React Flow, JSZip and the
 * drill-down canvas, and the search panel is equally unused until a
 * configuration is open. Neither belongs in the bundle that renders the
 * landing page.
 */
const loadDesignerView = () => import('./DesignerView');
const loadSearchPanel = () => import('./SearchPanel');
const DesignerView = React.lazy(() =>
  loadDesignerView().then(m => ({ default: m.DesignerView })),
);
const SearchPanel = React.lazy(() =>
  loadSearchPanel().then(m => ({ default: m.SearchPanel })),
);
/* The trace bar reads the format lineage and opens the drill-down, both of
   which live in the designer's chunk. */
const TraceBar = React.lazy(() =>
  import('./designers/TraceBar').then(m => ({ default: m.TraceBar })),
);

/**
 * Fetch the split chunks once the landing page is idle. The files then come
 * from the build the page was loaded with — a deploy in between would
 * otherwise leave the first designer open asking for files that are gone —
 * and opening a configuration no longer waits on the download.
 */
function prefetchWorkspaceChunks(): () => void {
  const run = () => { void loadDesignerView().catch(() => {}); void loadSearchPanel().catch(() => {}); };
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}
import { LandingPage } from './LandingPage';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastHost } from './ToastHost';
import { FnoIngestOverlay } from './FnoIngestPanel';
import { ActivityBar } from './ActivityBar';
import { IndigoScope } from './IndigoScope';
import { TouchTitleTooltip } from './TouchTitleTooltip';
import { VersionComparePicker } from './VersionComparePicker';
import { useCompactLayout, useStackedLayout } from '../utils/responsive';
import { matchWorkspaceShortcut } from '../utils/workspace-shortcuts';
import { isSearchInputFocused, requestSearchFocus } from '../utils/search-focus';
import { t, useLocale } from '../i18n';

// ────────────────────────── styles ──────────────────────────

const useAppStyles = makeStyles({
  landingShell: {
    position: 'fixed',
    inset: 0,
    overflow: 'auto',
    backgroundColor: 'var(--bg-primary)',
  },
  // The light work area sits on the grey ground beside the indigo sidebar.
  shell: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    overflow: 'hidden',
    backgroundColor: 'var(--er-bg)',
    color: 'var(--er-text)',
    fontFamily: tokens.fontFamilyBase,
  },
  workarea: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  /* Between the header and the status bar: the panels, then the trace of the
     selected element, as rounded cards on the ground. */
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minHeight: 0,
    padding: '12px',
    boxSizing: 'border-box',
    '@media (max-width: 600px)': {
      gap: '8px',
      padding: '8px',
    },
  },
  panels: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
  },
  /** The indigo explorer beside the rail fills its column. */
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: 'var(--er-side-bg)',
  },
  /** A panel of the work area: the designer, the properties, search. */
  card: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    backgroundColor: 'var(--er-surface)',
    border: '1px solid var(--er-border)',
    borderRadius: 'var(--er-radius-xl)',
    boxShadow: 'var(--er-shadow-1)',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  sidebarRightFullscreen: {
    height: '100%',
    width: '100%',
  },
  /* ── Narrow (tablet portrait / phone) single-column layout ───────────────
     Below the breakpoint there is no room for three columns, so panels stack
     on top of the designer instead of squeezing it. The designer stays mounted
     and merely hidden — remounting it on every panel toggle would re-parse and
     re-lay out the whole format tree. */
  narrowStack: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
  },
  narrowPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  narrowHidden: {
    display: 'none',
  },
  panelContent: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  /** Search / where-used own the whole panel body below the tab strip. */
  searchPaneFill: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  // The sidebar's edge: the handle only lights up while hovered or dragged
  // (the hit area is wider than the line).
  resizeHandle: {
    width: '4px',
    marginLeft: '-2px',
    marginRight: '-2px',
    position: 'relative',
    zIndex: 1,
    backgroundColor: 'transparent',
    cursor: 'col-resize',
    transitionProperty: 'background-color',
    transitionDuration: '100ms',
    transitionDelay: '0ms',
    ':hover': { backgroundColor: 'var(--er-accent-fill)', transitionDelay: '200ms' },
    ':active': { backgroundColor: 'var(--er-accent-fill)' },
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 8px 0 20px',
    borderBottom: '1px solid var(--er-border)',
    backgroundColor: 'var(--er-chrome)',
    height: 'var(--wb-header-h)',
    minHeight: 'var(--wb-header-h)',
    flexShrink: 0,
  },
  panelHeaderTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
    fontSize: 'var(--er-text-xs)',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--er-text-muted)',
  },
  panelHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  // Right panel tab strip: the panels by name, the open one underlined in the
  // accent.
  rightTabStrip: {
    display: 'flex',
    alignItems: 'stretch',
    height: 'var(--wb-header-h)',
    minHeight: 'var(--wb-header-h)',
    flexShrink: 0,
    padding: '0 4px 0 8px',
    gap: '2px',
    backgroundColor: 'var(--er-chrome)',
    borderBottom: '1px solid var(--er-border)',
  },
  rightTab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 8px',
    border: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontSize: 'var(--er-text-md)',
    fontFamily: tokens.fontFamilyBase,
    fontWeight: 500,
    cursor: 'pointer',
    // A narrow panel used to wrap "Kde je použito" onto a second line.
    // Shrink to an ellipsis instead.
    minWidth: 0,
    whiteSpace: 'nowrap',
    overflowX: 'hidden',
    textOverflow: 'ellipsis',
    transitionProperty: 'color',
    transitionDuration: 'var(--er-duration-fast)',
    ':hover': {
      color: 'var(--er-text)',
    },
  },
  rightTabActive: {
    color: 'var(--er-text)',
    fontWeight: 600,
    boxShadow: 'inset 0 -2px 0 var(--er-accent-fill)',
    ':hover': {
      color: 'var(--er-text)',
    },
  },
  rightTabIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    lineHeight: '1',
  },
  rightTabSpacer: {
    flex: 1,
    minWidth: 0,
  },
  rightTabActions: {
    display: 'flex',
    alignSelf: 'center',
    alignItems: 'center',
    padding: '0 4px',
  },
});

const useStatusBarStyles = makeStyles({
  root: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    height: 'var(--wb-statusbar-h)',
    minHeight: 'var(--wb-statusbar-h)',
    padding: '0 8px',
    backgroundColor: 'var(--er-surface)',
    color: 'var(--er-text-muted)',
    fontSize: 'var(--er-text-sm)',
    fontFamily: tokens.fontFamilyBase,
    borderTop: '1px solid var(--er-border)',
    flexShrink: 0,
  },
  info: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  // VS Code status bar items: plain text cells that tint on hover.
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: '4px',
    padding: '0 6px',
    borderRadius: 0,
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--er-text-muted)',
    fontSize: 'var(--er-text-sm)',
    maxWidth: '260px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  spacer: { marginLeft: 'auto' },
  warnBtn: {
    cursor: 'pointer',
    transitionProperty: 'background-color, color',
    transitionDuration: 'var(--er-duration-fast)',
    ':hover': {
      backgroundColor: 'var(--er-hover)',
      color: 'var(--er-text)',
    },
  },
  warnOk: {
    color: 'var(--er-text-muted)',
  },
  warnIssues: {
    color: 'var(--er-warning)',
  },
  popover: {
    minWidth: '320px',
    maxWidth: '480px',
    padding: 0,
  },
  popoverHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  popoverList: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    maxHeight: '280px',
    overflow: 'auto',
  },
  popoverItem: {
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    fontSize: tokens.fontSizeBase200,
  },
  popoverItemWarning: {
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorPaletteYellowBorderActive,
  },
  popoverItemError: {
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorPaletteRedBorderActive,
  },
});

// ────────────────────────── App ──────────────────────────

export function App() {
  useLocale();
  const styles = useAppStyles();
  // The side panels open as the user left them. Only the user's own toggles
  // are remembered: a drill-down tab hiding both, or a narrow window dropping
  // the explorer, is not a choice to bring back after a reload.
  const [initialPanels] = useState(loadPanelVisibility);
  const [showLeft, setShowLeft] = useState(initialPanels.explorer);
  const [showRight, setShowRight] = useState(initialPanels.side);
  const [rightTab, setRightTab] = useState<SidePanelTab>(initialPanels.sideTab);
  const panelsRef = useRef<PanelVisibility>(initialPanels);
  panelsRef.current = { explorer: showLeft, side: showRight, sideTab: rightTab };
  const rememberPanels = useCallback((change: Partial<PanelVisibility>) => {
    savePanelVisibility({ ...panelsRef.current, ...change });
  }, []);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const landingRequest = useAppStore(s => s.landingRequest);
  useEffect(() => prefetchWorkspaceChunks(), []);
  useEffect(() => {
    if (landingRequest) setShowLanding(true);
  }, [landingRequest]);
  const [statusWarningsOpen, setStatusWarningsOpen] = useState(false);
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(focusedTabId);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const rebuildDerivedState = useAppStore(s => s.rebuildDerivedState);
  const fnoIngestStatus = useAppStore(s => s.fnoIngestStatus);
  const whereUsedTrigger = useAppStore(s => s.whereUsedTrigger);
  const setSearchPanelMode = useAppStore(s => s.setSearchPanelMode);

  // The search panel serves both tabs; a remembered where-used tab has to
  // put it in that mode.
  useEffect(() => {
    if (initialPanels.sideTab !== 'properties') setSearchPanelMode(initialPanels.sideTab);
  }, [initialPanels, setSearchPanelMode]);

  useEffect(() => {
    if (!whereUsedTrigger) return;
    setShowRight(true);
    setRightTab('where-used');
    setSearchPanelMode('where-used');
    rememberPanels({ side: true, sideTab: 'where-used' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whereUsedTrigger?.version]);

  useEffect(() => {
    if (configs.length > 0 && treeNodes.length !== configs.length) {
      rebuildDerivedState();
    }
  }, [configs.length, treeNodes.length, rebuildDerivedState]);

  // Designer is only shown when:
  // 1. showLanding is false (user navigated away from landing page)
  // 2. At least one configuration is loaded
  // 3. No F&O download is in progress (fnoIngestStatus is empty)
  // The third condition prevents the designer from appearing mid-download
  // if React processes the showLanding=false update before fnoIngestStatus=''
  // (Zustand and useState re-renders may be batched separately in some paths).
  const isLandingVisible = showLanding || configs.length === 0 || !!fnoIngestStatus;

  const handleFilesLoaded = useCallback(() => {
    setShowLanding(false);
  }, []);

  // Below 900 px there is only room for the designer plus one side panel, so
  // opening one closes the other. A ref keeps the toggles below stable while
  // still reading the live value.
  const isCompact = useCompactLayout();
  const isStacked = useStackedLayout();
  const isCompactRef = useRef(isCompact);
  isCompactRef.current = isCompact;

  // Shrinking the window while both were open leaves no room; drop the
  // explorer so the panel the user touched last stays visible.
  useEffect(() => {
    if (isCompact && showLeft && showRight) setShowLeft(false);
  }, [isCompact, showLeft, showRight]);

  const toggleExplorer = useCallback(() => {
    const next = !panelsRef.current.explorer;
    setShowLeft(next);
    if (next && isCompactRef.current) {
      setShowRight(false);
      setRightFullscreen(false);
      rememberPanels({ explorer: true, side: false });
    } else {
      rememberPanels({ explorer: next });
    }
  }, [rememberPanels]);

  // A side panel needs a bigger share of a tablet than of a desktop monitor:
  // 25 % of an 834 px viewport is a 208 px tree, which truncates almost every
  // element name. The sidebar is a share of the window; the right panel a
  // share of the work area beside it.
  const leftPaneSize = isCompact ? 42 : 25;
  const rightPaneSize = isCompact ? 50 : 34;
  const centerPaneSize = showRight ? 100 - rightPaneSize : 100;

  const closeSidePanel = useCallback(() => {
    setShowRight(false);
    setRightFullscreen(false);
    rememberPanels({ side: false });
  }, [rememberPanels]);

  const openSidePanel = useCallback((tab: SidePanelTab) => {
    setRightTab(tab);
    if (tab !== 'properties') setSearchPanelMode(tab);
    setShowRight(true);
    if (isCompactRef.current) {
      setShowLeft(false);
      rememberPanels({ side: true, sideTab: tab, explorer: false });
    } else {
      rememberPanels({ side: true, sideTab: tab });
    }
  }, [rememberPanels, setSearchPanelMode]);

  /* From the keyboard (Ctrl+F), an open panel whose box does not have the
     cursor gets it back instead of closing; a click on the activity bar
     toggles as before. Opening always puts the cursor in the box. */
  const toggleSearch = useCallback((fromShortcut = false) => {
    if (showRight && rightTab === 'search') {
      if (fromShortcut && !isSearchInputFocused()) {
        requestSearchFocus();
        return;
      }
      closeSidePanel();
    } else {
      openSidePanel('search');
      requestSearchFocus();
    }
  }, [showRight, rightTab, closeSidePanel, openSidePanel]);

  const toggleWhereUsed = useCallback((fromShortcut = false) => {
    if (showRight && rightTab === 'where-used') {
      if (fromShortcut && !isSearchInputFocused()) {
        requestSearchFocus();
        return;
      }
      closeSidePanel();
    } else {
      openSidePanel('where-used');
      requestSearchFocus();
    }
  }, [showRight, rightTab, closeSidePanel, openSidePanel]);

  const handleRightTabChange = useCallback((tab: SidePanelTab) => {
    setRightTab(tab);
    if (tab !== 'properties') {
      setSearchPanelMode(tab);
      requestSearchFocus();
    }
    rememberPanels({ sideTab: tab });
  }, [setSearchPanelMode, rememberPanels]);

  const toggleProperties = useCallback(() => {
    if (showRight && rightTab === 'properties') closeSidePanel();
    else openSidePanel('properties');
  }, [showRight, rightTab, closeSidePanel, openSidePanel]);

  // Keep the latest landing state readable from the (stable) keydown handler.
  const landingVisibleRef = useRef(isLandingVisible);
  landingVisibleRef.current = isLandingVisible;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Workspace shortcuts have nothing to act on while the landing page is
      // shown (panels are not mounted) — leave the browser's defaults.
      if (landingVisibleRef.current) return;
      const target = e.target as HTMLElement | null;
      const inEditable = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable);

      const shortcut = matchWorkspaceShortcut(e);
      if (!shortcut) return;
      // Inside the search box, Ctrl+F (or the where-used shortcut) still
      // closes the panel; every other field keeps its keys.
      const inSearchBox = !!target && target.dataset.searchInput === 'true';
      if (inEditable && !(inSearchBox && (shortcut === 'search' || shortcut === 'whereUsed'))) return;
      e.preventDefault();
      switch (shortcut) {
        case 'search': toggleSearch(true); break;
        case 'whereUsed': toggleWhereUsed(true); break;
        case 'explorer': toggleExplorer(); break;
        case 'properties': toggleProperties(); break;
        case 'back': navigateBack(); break;
        case 'forward': navigateForward(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigateBack, navigateForward, toggleSearch, toggleWhereUsed, toggleProperties, toggleExplorer]);

  // Entering a drill-down tab hides the side panels once; re-opening them
  // while staying on that tab must survive unrelated tab-list changes.
  const activeTabKind = openTabs.find(tab => tab.id === activeTabId)?.kind;
  const isDrillDownActive = activeTabKind === 'drillDown';
  useEffect(() => {
    if (isDrillDownActive) {
      setShowLeft(false);
      setShowRight(false);
      setRightFullscreen(false);
    }
  }, [isDrillDownActive, activeTabId]);

  if (isLandingVisible) {
    return (
      <div className={mergeClasses('app-shell', styles.landingShell)}>
        <ErrorBoundary label={t.errorAreaLanding}>
          <LandingPage onFilesLoaded={handleFilesLoaded} />
        </ErrorBoundary>
        <ToastHost />
        <FnoIngestOverlay />
        <TouchTitleTooltip />
      </div>
    );
  }

  const goHome = () => { setShowLanding(true); };
  const rightPanel = (fullscreen: boolean, narrow = false) => (
    <RightPanel
      tab={rightTab}
      onTabChange={handleRightTabChange}
      fullscreen={fullscreen}
      hideSizeToggle={narrow}
      onExpand={() => setRightFullscreen(true)}
      onCollapse={() => setRightFullscreen(false)}
      onClose={closeSidePanel}
      panelContentClass={styles.panelContent}
    />
  );
  const explorer = (className?: string) => (
    <IndigoScope className={className}>
      <ErrorBoundary label={t.explorer}>
        <ConfigExplorer />
      </ErrorBoundary>
    </IndigoScope>
  );
  const designer = (
    <ErrorBoundary label={t.errorAreaDesigner}>
      <React.Suspense fallback={<PanelLoading />}>
        <DesignerView />
      </React.Suspense>
    </ErrorBoundary>
  );

  /* Header, the panels as cards, the trace of the selected element, footer. */
  const workarea = (
    <div className={styles.workarea}>
      <Toolbar />
      <div className={styles.main}>
        <div className={styles.panels}>
          {showRight && rightFullscreen ? (
            <div className={mergeClasses(styles.card, styles.sidebarRightFullscreen)}>
              {rightPanel(true)}
            </div>
          ) : isStacked ? (
            /* One column at a time: the designer stays mounted underneath so
               toggling a panel does not throw away its scroll and tab state. */
            <div className={styles.narrowStack}>
              <div className={mergeClasses(styles.card, (showLeft || showRight) && styles.narrowHidden)}>
                <div className={styles.panelContent}>{designer}</div>
              </div>
              {showLeft && explorer(mergeClasses(styles.sidebar, styles.card, styles.narrowPane))}
              {showRight && (
                <div className={mergeClasses(styles.card, styles.narrowPane)}>
                  {rightPanel(false, true)}
                </div>
              )}
            </div>
          ) : (
            /* Side panels come and go, so every panel carries an id and an
               order: without them the group ranks panels by when they
               mounted. The ids also key the remembered sizes, one layout
               per set of panels shown. */
            <PanelGroup direction="horizontal" autoSaveId={panelGroupSaveId('work', isCompact)}>
              <Panel id="designer" order={1} defaultSize={centerPaneSize} minSize={isCompact ? 30 : 35}>
                <div className={styles.card}>
                  <div className={styles.panelContent}>{designer}</div>
                </div>
              </Panel>
              {showRight && (
                <>
                  <PanelResizeHandle className="wb-card-gap" />
                  <Panel id="side-panel" order={2} defaultSize={rightPaneSize} minSize={isCompact ? 30 : 22} maxSize={isCompact ? 65 : 55}>
                    <div className={styles.card}>{rightPanel(false)}</div>
                  </Panel>
                </>
              )}
            </PanelGroup>
          )}
        </div>
        {/* Empty until a format element is selected. */}
        <React.Suspense fallback={null}>
          <TraceBar />
        </React.Suspense>
      </div>
      <StatusBar
        warningsOpen={statusWarningsOpen}
        setWarningsOpen={setStatusWarningsOpen}
      />
    </div>
  );

  return (
    <div className={mergeClasses('app-shell', styles.shell)}>
      <ActivityBar
        showLeft={showLeft}
        showRight={showRight}
        rightTab={rightTab}
        whereUsedActive={showRight && rightTab === 'where-used'}
        onToggleLeft={toggleExplorer}
        onToggleRight={toggleProperties}
        onToggleSearch={() => toggleSearch()}
        onToggleWhereUsed={() => toggleWhereUsed()}
        onGoHome={goHome}
      />
      {isStacked ? workarea : (
        /* The rail and the explorer span the window's height; the header and
           the work area sit beside them. The work panel keeps its place
           whether or not the explorer is open, so hiding it does not remount
           the designer. The explorer's width is remembered. */
        <PanelGroup direction="horizontal" autoSaveId={panelGroupSaveId('shell', isCompact)}>
          {showLeft && (
            <>
              <Panel id="explorer" order={1} defaultSize={leftPaneSize} minSize={isCompact ? 28 : 15} maxSize={isCompact ? 60 : 40}>
                {explorer(styles.sidebar)}
              </Panel>
              <PanelResizeHandle className={styles.resizeHandle} />
            </>
          )}
          <Panel id="work" order={2} defaultSize={showLeft ? 100 - leftPaneSize : 100} minSize={40}>
            {workarea}
          </Panel>
        </PanelGroup>
      )}
      <ToastHost />
      <FnoIngestOverlay />
      <VersionComparePicker />
      <TouchTitleTooltip />
    </div>
  );
}

/** Neutral placeholder while a lazily loaded panel arrives. */
function PanelLoading() {
  // A skeleton of the toolbar and a few rows, not a lone spinner: the panel
  // keeps the shape it is about to have, so it does not jump when it arrives.
  return (
    <div className="panel-skeleton" role="status" aria-label={t.landingLoading}>
      <div className="panel-skeleton__bar" />
      {[78, 64, 86, 52, 70, 60].map((w, i) => (
        <div key={i} className="panel-skeleton__row" style={{ ['--skeleton-w' as string]: `${w}%` }} />
      ))}
    </div>
  );
}

// ────────────────────────── RightPanel ──────────────────────────

function RightPanel({
  tab,
  onTabChange,
  fullscreen,
  hideSizeToggle,
  onExpand,
  onCollapse,
  onClose,
  panelContentClass,
}: {
  tab: SidePanelTab;
  onTabChange: (tab: SidePanelTab) => void;
  fullscreen: boolean;
  /** Narrow layout: the panel already fills the viewport, so expand/collapse
   *  would be a no-op control taking up scarce header width. */
  hideSizeToggle?: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
  panelContentClass: string;
}) {
  const styles = useAppStyles();
  return (
    <>
      <div className={styles.rightTabStrip} role="tablist">
        {/* Properties belongs here too: the sidebar can switch to it, so
            without this tab the strip showed no selection at all. */}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'properties'}
          className={mergeClasses(styles.rightTab, tab === 'properties' && styles.rightTabActive)}
          onClick={() => onTabChange('properties')}
          title={t.properties}
          aria-label={t.properties}
        >
          <span className={styles.rightTabIcon} aria-hidden><AppsListDetailRegular fontSize={13} /></span>
          {tab === 'properties' && t.properties}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          className={mergeClasses(styles.rightTab, tab === 'search' && styles.rightTabActive)}
          onClick={() => onTabChange('search')}
          title={t.search}
          aria-label={t.search}
        >
          <span className={styles.rightTabIcon} aria-hidden><SearchRegular fontSize={13} /></span>
          {tab === 'search' && t.search}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'where-used'}
          className={mergeClasses(styles.rightTab, tab === 'where-used' && styles.rightTabActive)}
          onClick={() => onTabChange('where-used')}
          title={t.whereUsedAction}
          aria-label={t.whereUsedAction}
        >
          <span className={styles.rightTabIcon} aria-hidden><LinkRegular fontSize={13} /></span>
          {tab === 'where-used' && t.whereUsedAction}
        </button>
        <div className={styles.rightTabSpacer} />
        <div className={styles.rightTabActions}>
          {!hideSizeToggle && (
            <Tooltip content={fullscreen ? t.panelRestore : t.panelMaximize} relationship="label" withArrow>
              <Button
                appearance="subtle"
                size="small"
                icon={fullscreen ? <ArrowMinimizeRegular /> : <ExpandUpRightRegular />}
                onClick={fullscreen ? onCollapse : onExpand}
                aria-label={fullscreen ? t.panelRestore : t.panelMaximize}
              />
            </Tooltip>
          )}
          <Tooltip content={t.panelClose} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              onClick={onClose}
              aria-label={t.panelClose}
            />
          </Tooltip>
        </div>
      </div>
      {tab === 'search' || tab === 'where-used' ? (
        <div className={styles.searchPaneFill}>
          <ErrorBoundary label={t.search}>
            <React.Suspense fallback={<PanelLoading />}>
              <SearchPanel />
            </React.Suspense>
          </ErrorBoundary>
        </div>
      ) : (
        <div className={panelContentClass}>
          <ErrorBoundary label={t.properties}>
            <PropertyInspector />
          </ErrorBoundary>
        </div>
      )}
    </>
  );
}

// ────────────────────────── StatusBar ──────────────────────────

/**
 * Slim footer: download progress, what the active tab derives from, validator
 * state and the current view mode. The number of loaded configurations is not
 * repeated here — the Explorer already lists them. Navigation (Home) and per-configuration
 * actions live in the sidebar and the Explorer — the status bar used to
 * repeat both.
 */
function StatusBar({ warningsOpen, setWarningsOpen }: {
  warningsOpen: boolean;
  setWarningsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const styles = useStatusBarStyles();
  const configs = useAppStore(s => s.configurations);
  const registry = useAppStore(s => s.registry);
  const warnings = useAppStore(s => s.warnings);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const fnoIngestStatus = useAppStore(s => s.fnoIngestStatus);
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(focusedTabId);

  const activeRelationship = useMemo(() => {
    const activeTab = openTabs.find(tab => tab.id === activeTabId);
    if (!activeTab) return null;
    const cfg = configs[activeTab.configIndex];
    if (!cfg) return null;
    const kind = cfg.content.kind;
    const baseSolutionId = cfg.solutionVersion.solution.baseSolutionId;
    if (!baseSolutionId) return null;
    const normalizedBase = baseSolutionId.replace(/[{}]/g, '').toLowerCase();
    const parentCfg = configs.find(c =>
      c.content.kind === 'DataModel' &&
      c.solutionVersion.solution.id?.replace(/[{}]/g, '').toLowerCase() === normalizedBase
    );
    if (!parentCfg) return null;
    const parentName = parentCfg.solutionVersion.solution.name;
    return { kind, parentName };
  }, [openTabs, activeTabId, configs]);

  return (
    <div className={mergeClasses(styles.root, 'app-statusbar')} role="status">
      {fnoIngestStatus && (
        <span className={styles.chip} title={fnoIngestStatus}>
          <ArrowSyncRegular fontSize={12} style={{ animation: 'spin 1.2s linear infinite' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{fnoIngestStatus}</span>
        </span>
      )}

      {activeRelationship && (
        <span
          className={styles.chip}
          title={t.statusDerivedFromModelTitle(activeRelationship.kind, activeRelationship.parentName)}
        >
          <ModelKindIcon fontSize={13} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
            {t.statusDerivedFromModel}{activeRelationship.parentName}
          </span>
        </span>
      )}

      <div className={styles.spacer} />

      <Popover
        open={warningsOpen && warnings.length > 0}
        onOpenChange={(_, d) => setWarningsOpen(Boolean(d.open))}
        withArrow
        positioning="above-end"
      >
        <PopoverTrigger disableButtonEnhancement>
          <span
            className={mergeClasses(
              styles.chip,
              styles.warnBtn,
              warnings.length === 0 ? styles.warnOk : styles.warnIssues,
              // Stable hooks for the status pill's colour (ledger-dialogs.css).
              warnings.length === 0 ? 'app-statusbar__validator app-statusbar__validator--ok' : 'app-statusbar__validator app-statusbar__validator--issues',
            )}
            onClick={() => warnings.length > 0 && setWarningsOpen(v => !v)}
            title={warnings.length === 0 ? t.validatorOk : t.validatorIssues(warnings.length)}
            role="button"
            tabIndex={0}
          >
            {warnings.length === 0
              ? <CheckmarkCircleRegular fontSize={14} />
              : <WarningRegular fontSize={14} />}
            <span>
              {warnings.length === 0 ? t.validatorOk : t.validatorIssues(warnings.length)}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverSurface className={mergeClasses(styles.popover, 'app-statusbar__warnings')}>
          <div className={styles.popoverHeader}>
            <Body1Strong>{t.warnings} ({warnings.length})</Body1Strong>
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              onClick={() => setWarningsOpen(false)}
              aria-label={t.dismiss}
            />
          </div>
          <ul className={styles.popoverList}>
            {warnings.map((w, i) => {
              const cfg = configs[w.configIndex];
              const cfgName = cfg ? cfg.solutionVersion.solution.name : `#${w.configIndex}`;
              const severity = w.severity === 'error' ? styles.popoverItemError : styles.popoverItemWarning;
              return (
                <li key={i} className={mergeClasses(styles.popoverItem, severity)}>
                  <Caption1Strong>{cfgName}</Caption1Strong>
                  <Caption1 style={{ whiteSpace: 'pre-wrap' }}>{w.message}</Caption1>
                </li>
              );
            })}
          </ul>
        </PopoverSurface>
      </Popover>

      <span className={styles.chip}>
        {showTechnicalDetails ? t.technicalView : t.consultantView}
      </span>
      {showTechnicalDetails && <span className={styles.info}>{t.statusGuidCount(registry.guidCount)}</span>}
    </div>
  );
}
