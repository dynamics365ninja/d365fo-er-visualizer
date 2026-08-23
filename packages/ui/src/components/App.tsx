import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  makeStyles,
  shorthands,
  tokens,
  mergeClasses,
  Button,
  Tooltip,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbDivider,
  BreadcrumbButton,
  Popover,
  PopoverTrigger,
  PopoverSurface,
  Caption1,
  Caption1Strong,
  Body1Strong,
  Spinner,
} from '@fluentui/react-components';
import {
  HomeRegular,
  ChevronRightRegular,
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
import { useAppStore } from '../state/store';
import { ConfigExplorer } from './ConfigExplorer';
import { PropertyInspector } from './PropertyInspector';
import { Toolbar } from './Toolbar';
import { TabBar } from './TabBar';

/**
 * Split at the workspace boundary: the designer pulls React Flow, JSZip and the
 * drill-down canvas, and the search panel is equally unused until a
 * configuration is open. Neither belongs in the bundle that renders the
 * landing page.
 */
const DesignerView = React.lazy(() =>
  import('./DesignerView').then(m => ({ default: m.DesignerView })),
);
const SearchPanel = React.lazy(() =>
  import('./SearchPanel').then(m => ({ default: m.SearchPanel })),
);
import { LandingPage } from './LandingPage';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastHost } from './ToastHost';
import { CommandPalette, type CommandItem } from './CommandPalette';
import { ActivityBar } from './ActivityBar';
import { t, locale, useLocale } from '../i18n';

// ────────────────────────── styles ──────────────────────────

const useAppStyles = makeStyles({
  landingShell: {
    position: 'fixed',
    inset: 0,
    overflow: 'auto',
    backgroundColor: 'var(--bg-primary)',
  },
  shell: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    overflow: 'hidden',
    backgroundColor: 'var(--er-bg-soft)',
    color: 'var(--er-text)',
    fontFamily: tokens.fontFamilyBase,
  },
  workarea: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    backgroundColor: 'var(--er-bg-soft)',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    backgroundColor: 'var(--er-surface)',
    borderRight: '1px solid var(--er-border)',
    overflow: 'hidden',
  },
  sidebarRight: {
    borderRight: 'none',
    borderLeft: '1px solid var(--er-border)',
  },
  sidebarRightFullscreen: {
    height: '100%',
    width: '100%',
    borderLeft: 'none',
    borderRight: 'none',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    backgroundColor: 'var(--er-bg-soft)',
    overflow: 'hidden',
  },
  panelContent: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  resizeHandleH: {
    height: '5px',
    backgroundColor: 'var(--er-border)',
    cursor: 'row-resize',
    transitionProperty: 'background-color',
    transitionDuration: '140ms',
    ':hover': { backgroundColor: 'var(--er-accent)' },
    ':active': { backgroundColor: 'var(--er-accent-hover)' },
  },
  propertiesStrip: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  propertiesStripHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 12px',
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--er-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    borderTop: '1px solid var(--er-border)',
    borderBottom: '1px solid var(--er-border)',
    backgroundColor: 'var(--er-surface-2)',
    flexShrink: 0,
  },
  propertiesStripContent: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  resizeHandle: {
    width: '5px',
    backgroundColor: 'var(--er-border)',
    cursor: 'col-resize',
    transitionProperty: 'background-color',
    transitionDuration: '140ms',
    ':hover': { backgroundColor: 'var(--er-accent)' },
    ':active': { backgroundColor: 'var(--er-accent-hover)' },
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 8px 0 14px',
    borderBottom: '1px solid var(--er-border)',
    backgroundColor: 'var(--er-surface)',
    height: '40px',
    minHeight: '40px',
    flexShrink: 0,
  },
  panelHeaderTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
    fontFamily: 'var(--er-font-display)',
    fontSize: '13px',
    fontWeight: 600,
  },
  panelHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  // Right panel tab strip — segmented control, as on the site
  rightTabStrip: {
    display: 'flex',
    alignItems: 'center',
    minHeight: '44px',
    flexShrink: 0,
    padding: '0 8px 0 10px',
    gap: '4px',
    backgroundColor: 'var(--er-surface)',
    borderBottom: '1px solid var(--er-border)',
  },
  rightTab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '28px',
    padding: '0 11px',
    border: '1px solid transparent',
    borderRadius: 'var(--er-radius-md)',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyBase,
    fontWeight: 500,
    cursor: 'pointer',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '140ms',
    ':hover': {
      color: 'var(--er-text)',
      backgroundColor: 'var(--er-surface-2)',
    },
  },
  rightTabActive: {
    color: 'var(--er-accent)',
    fontWeight: 600,
    backgroundColor: 'var(--er-accent-soft)',
    ...shorthands.borderColor('var(--er-accent-border)'),
    ':hover': {
      backgroundColor: 'var(--er-accent-soft)',
      color: 'var(--er-accent)',
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
    alignItems: 'center',
    padding: '0 4px',
  },
});

const useBreadcrumbStyles = makeStyles({
  root: {
    minWidth: 0,
  },
});

const useStatusBarStyles = makeStyles({
  root: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 12px',
    height: '30px',
    minHeight: '30px',
    backgroundColor: 'var(--er-surface)',
    color: 'var(--er-text-muted)',
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyBase,
    borderTop: '1px solid var(--er-border)',
    flexShrink: 0,
  },
  info: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '2px 8px',
    borderRadius: 'var(--er-radius-md)',
    backgroundColor: 'var(--er-surface-2)',
    border: '1px solid var(--er-border)',
    color: 'var(--er-text-muted)',
    fontSize: tokens.fontSizeBase100,
    maxWidth: '260px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  spacer: { marginLeft: 'auto' },
  warnBtn: {
    cursor: 'pointer',
    transitionProperty: 'background-color, border-color',
    transitionDuration: '120ms',
  },
  warnOk: {
    color: 'var(--er-success)',
    ...shorthands.borderColor('var(--er-success-border)'),
    backgroundColor: 'var(--er-success-soft)',
  },
  warnIssues: {
    color: 'var(--er-danger)',
    ...shorthands.borderColor('var(--er-danger-border)'),
    backgroundColor: 'var(--er-danger-soft)',
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
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(false);
  const [rightTab, setRightTab] = useState<'properties' | 'search' | 'where-used'>('properties');
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [showPropsStrip, setShowPropsStrip] = useState(true);
  const [showLanding, setShowLanding] = useState(true);
  const landingRequest = useAppStore(s => s.landingRequest);
  useEffect(() => {
    if (landingRequest) setShowLanding(true);
  }, [landingRequest]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusWarningsOpen, setStatusWarningsOpen] = useState(false);
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const cycleTheme = useAppStore(s => s.cycleTheme);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const rebuildDerivedState = useAppStore(s => s.rebuildDerivedState);
  const requestExplorerExpand = useAppStore(s => s.requestExplorerExpand);
  const fnoIngestStatus = useAppStore(s => s.fnoIngestStatus);
  const whereUsedTrigger = useAppStore(s => s.whereUsedTrigger);
  const setSearchPanelMode = useAppStore(s => s.setSearchPanelMode);

  useEffect(() => {
    if (!whereUsedTrigger) return;
    setShowRight(true);
    setRightTab('where-used');
    setSearchPanelMode('where-used');
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

  const toggleSearch = useCallback(() => {
    if (showRight && rightTab === 'search') {
      setShowRight(false);
      setRightFullscreen(false);
    } else {
      setRightTab('search');
      setSearchPanelMode('search');
      setShowRight(true);
    }
  }, [showRight, rightTab, setSearchPanelMode]);

  const toggleWhereUsed = useCallback(() => {
    if (showRight && rightTab === 'where-used') {
      setShowRight(false);
      setRightFullscreen(false);
    } else {
      setRightTab('where-used');
      setSearchPanelMode('where-used');
      setShowRight(true);
    }
  }, [showRight, rightTab, setSearchPanelMode]);

  const handleRightTabChange = useCallback((tab: 'properties' | 'search' | 'where-used') => {
    setRightTab(tab);
    if (tab === 'search') setSearchPanelMode('search');
    else if (tab === 'where-used') setSearchPanelMode('where-used');
  }, [setSearchPanelMode]);

  const toggleProperties = useCallback(() => {
    if (showRight && rightTab === 'properties') {
      setShowRight(false);
      setRightFullscreen(false);
    } else {
      setRightTab('properties');
      setShowRight(true);
    }
  }, [showRight, rightTab]);

  // Keep the latest landing state readable from the (stable) keydown handler.
  const landingVisibleRef = useRef(isLandingVisible);
  landingVisibleRef.current = isLandingVisible;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Workspace shortcuts have nothing to act on while the landing page is
      // shown (palette/panels are not mounted) — leave the browser's defaults.
      if (landingVisibleRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const inEditable = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable);

      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(p => !p);
        return;
      }
      if (inEditable) return;

      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggleSearch();
        return;
      }
      if (mod && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        toggleWhereUsed();
        return;
      }
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setShowLeft(s => !s);
        return;
      }
      if (mod && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        toggleProperties();
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateBack();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        navigateForward();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigateBack, navigateForward, toggleSearch, toggleWhereUsed, toggleProperties]);

  const paletteCommands = useMemo<CommandItem[]>(() => [
    { id: 'home', group: t.cmdGroupNav, label: t.cmdGoHome, action: () => { setShowLanding(true); } },
    { id: 'back', group: t.cmdGroupNav, label: t.cmdBack, hint: 'Alt+←', action: navigateBack },
    { id: 'forward', group: t.cmdGroupNav, label: t.cmdForward, hint: 'Alt+→', action: navigateForward },
    { id: 'search', group: t.cmdGroupView, label: t.cmdToggleSearch, hint: 'Ctrl+F', action: toggleSearch },
    { id: 'explorer', group: t.cmdGroupView, label: t.cmdToggleExplorer, hint: 'Ctrl+B', action: () => setShowLeft(s => !s) },
    { id: 'props', group: t.cmdGroupView, label: t.cmdToggleProperties, hint: 'Ctrl+J', action: toggleProperties },
    { id: 'theme', group: t.cmdGroupView, label: t.cmdToggleTheme, action: cycleTheme },
    { id: 'tech', group: t.cmdGroupView, label: t.cmdToggleTechnical, action: () => setShowTechnicalDetails(!showTechnicalDetails) },
    { id: 'collapse', group: t.cmdGroupTools, label: t.cmdCollapseAll, action: () => requestExplorerExpand('none') },
    { id: 'expand', group: t.cmdGroupTools, label: t.cmdExpandAll, action: () => requestExplorerExpand('all') },
  ], [navigateBack, navigateForward, toggleSearch, toggleProperties, cycleTheme, setShowTechnicalDetails, showTechnicalDetails, requestExplorerExpand, locale]);

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
      <div className={styles.landingShell}>
        <ErrorBoundary label="Landing">
          <LandingPage onFilesLoaded={handleFilesLoaded} />
        </ErrorBoundary>
        <ToastHost />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <ActivityBar
        showLeft={showLeft}
        showRight={showRight}
        rightTab={rightTab}
        whereUsedActive={showRight && rightTab === 'where-used'}
        onToggleLeft={() => setShowLeft(s => !s)}
        onToggleRight={toggleProperties}
        onToggleSearch={toggleSearch}
        onToggleWhereUsed={toggleWhereUsed}
        onGoHome={() => { setShowLanding(true); }}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className={styles.workarea}>
          <Toolbar
            breadcrumb={<AppBreadcrumb onOpenHome={() => { setShowLanding(true); }} />}
          />
          <div className={styles.main}>
            {showRight && rightFullscreen ? (
              <div className={mergeClasses(styles.sidebar, styles.sidebarRight, styles.sidebarRightFullscreen)}>
                <RightPanel
                  tab={rightTab}
                  onTabChange={handleRightTabChange}
                  fullscreen
                  onExpand={() => setRightFullscreen(true)}
                  onCollapse={() => setRightFullscreen(false)}
                  onClose={() => { setShowRight(false); setRightFullscreen(false); }}
                  panelContentClass={styles.panelContent}
                  showPropsStrip={showPropsStrip}
                  setShowPropsStrip={setShowPropsStrip}
                />
              </div>
            ) : (
              <PanelGroup direction="horizontal">
                {showLeft && (
                  <>
                    <Panel defaultSize={26} minSize={15} maxSize={40}>
                      <div className={styles.sidebar}>
                        <ErrorBoundary label="Explorer">
                          <ConfigExplorer />
                        </ErrorBoundary>
                      </div>
                    </Panel>
                    <PanelResizeHandle className={styles.resizeHandle} />
                  </>
                )}

                <Panel defaultSize={showLeft && showRight ? 56 : showLeft || showRight ? 78 : 100} minSize={30}>
                  <div className={styles.center}>
                    <TabBar />
                    <div className={styles.panelContent}>
                      <ErrorBoundary label="Designer">
                        <React.Suspense fallback={<PanelLoading />}>
                          <DesignerView />
                        </React.Suspense>
                      </ErrorBoundary>
                    </div>
                  </div>
                </Panel>

                {showRight && (
                  <>
                    <PanelResizeHandle className={styles.resizeHandle} />
                    <Panel defaultSize={28} minSize={20} maxSize={50}>
                      <div className={mergeClasses(styles.sidebar, styles.sidebarRight)}>
                        <RightPanel
                          tab={rightTab}
                          onTabChange={handleRightTabChange}
                          fullscreen={false}
                          onExpand={() => setRightFullscreen(true)}
                          onCollapse={() => setRightFullscreen(false)}
                          onClose={() => { setShowRight(false); setRightFullscreen(false); }}
                          panelContentClass={styles.panelContent}
                          showPropsStrip={showPropsStrip}
                          setShowPropsStrip={setShowPropsStrip}
                        />
                      </div>
                    </Panel>
                  </>
                )}
              </PanelGroup>
            )}
          </div>
          <StatusBar
            warningsOpen={statusWarningsOpen}
            setWarningsOpen={setStatusWarningsOpen}
          />
      </div>
      <ToastHost />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        extraCommands={paletteCommands}
      />
    </div>
  );
}

/** Neutral placeholder while a lazily loaded panel arrives. */
function PanelLoading() {
  return (
    <div
      role="status"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <Spinner size="small" label={t.landingLoading} />
    </div>
  );
}

// ────────────────────────── RightPanel ──────────────────────────

function RightPanel({
  tab,
  onTabChange,
  fullscreen,
  onExpand,
  onCollapse,
  onClose,
  panelContentClass,
  showPropsStrip,
  setShowPropsStrip,
}: {
  tab: 'properties' | 'search' | 'where-used';
  onTabChange: (tab: 'properties' | 'search' | 'where-used') => void;
  fullscreen: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
  panelContentClass: string;
  /** Lifted to the parent: RightPanel is mounted at two tree positions
   * (docked / fullscreen), so local state would reset on every switch. */
  showPropsStrip: boolean;
  setShowPropsStrip: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const styles = useAppStyles();
  return (
    <>
      <div className={styles.rightTabStrip} role="tablist">
        {/* Properties belongs here too: the ActivityBar can switch to it, so
            without this tab the strip showed no selection at all. */}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'properties'}
          className={mergeClasses(styles.rightTab, tab === 'properties' && styles.rightTabActive)}
          onClick={() => onTabChange('properties')}
        >
          <span className={styles.rightTabIcon} aria-hidden><AppsListDetailRegular fontSize={13} /></span>
          {t.properties}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          className={mergeClasses(styles.rightTab, tab === 'search' && styles.rightTabActive)}
          onClick={() => onTabChange('search')}
        >
          <span className={styles.rightTabIcon} aria-hidden><SearchRegular fontSize={13} /></span>
          {t.search}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'where-used'}
          className={mergeClasses(styles.rightTab, tab === 'where-used' && styles.rightTabActive)}
          onClick={() => onTabChange('where-used')}
        >
          <span className={styles.rightTabIcon} aria-hidden><LinkRegular fontSize={13} /></span>
          {t.whereUsedAction}
        </button>
        <div className={styles.rightTabSpacer} />
        <div className={styles.rightTabActions}>
          <Tooltip content={fullscreen ? t.collapse : t.expand} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={fullscreen ? <ArrowMinimizeRegular /> : <ExpandUpRightRegular />}
              onClick={fullscreen ? onCollapse : onExpand}
              aria-label={fullscreen ? t.collapse : t.expand}
            />
          </Tooltip>
          <Tooltip content={t.dismiss} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              onClick={onClose}
              aria-label={t.dismiss}
            />
          </Tooltip>
        </div>
      </div>
      {tab === 'search' || tab === 'where-used' ? (
        showPropsStrip ? (
          <PanelGroup direction="vertical" style={{ flex: 1, minHeight: 0 }}>
            <Panel defaultSize={60} minSize={25}>
              <ErrorBoundary label="Search">
                <React.Suspense fallback={<PanelLoading />}>
                  <SearchPanel />
                </React.Suspense>
              </ErrorBoundary>
            </Panel>
            <PanelResizeHandle className={styles.resizeHandleH} />
            <Panel defaultSize={40} minSize={15}>
              <div className={styles.propertiesStrip}>
                <div className={styles.propertiesStripHeader}>
                  <AppsListDetailRegular fontSize={12} />
                  {t.properties}
                  <div className={styles.rightTabSpacer} />
                  <Tooltip content={t.hideProperties} relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<DismissRegular fontSize={12} />}
                      onClick={() => setShowPropsStrip(false)}
                      aria-label={t.hideProperties}
                    />
                  </Tooltip>
                </div>
                <div className={styles.propertiesStripContent}>
                  <ErrorBoundary label="Inspector">
                    <PropertyInspector />
                  </ErrorBoundary>
                </div>
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <div className={styles.propertiesStrip} style={{ flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ErrorBoundary label="Search">
                <React.Suspense fallback={<PanelLoading />}>
                  <SearchPanel />
                </React.Suspense>
              </ErrorBoundary>
            </div>
            <div className={styles.propertiesStripHeader}>
              <AppsListDetailRegular fontSize={12} />
              {t.properties}
              <div className={styles.rightTabSpacer} />
              <Tooltip content={t.showProperties} relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ExpandUpRightRegular fontSize={12} />}
                  onClick={() => setShowPropsStrip(true)}
                  aria-label={t.showProperties}
                />
              </Tooltip>
            </div>
          </div>
        )
      ) : (
        <div className={panelContentClass}>
          <ErrorBoundary label="Inspector">
            <PropertyInspector />
          </ErrorBoundary>
        </div>
      )}
    </>
  );
}

// ────────────────────────── Breadcrumb ──────────────────────────

function AppBreadcrumb({ onOpenHome }: { onOpenHome: () => void }) {
  const styles = useBreadcrumbStyles();
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const configurations = useAppStore(s => s.configurations);
  const active = openTabs.find(tab => tab.id === activeTabId);
  if (!active) return null;

  const parts: string[] = [];
  const cfg = configurations[active.configIndex];
  if (cfg) parts.push(cfg.solutionVersion.solution.name);
  if (active.label && active.label !== parts[0]) parts.push(active.label);

  return (
    <Breadcrumb className={styles.root} size="small">
      <BreadcrumbItem>
        <BreadcrumbButton icon={<HomeRegular />} onClick={onOpenHome} aria-label={t.breadcrumbHome} />
      </BreadcrumbItem>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <BreadcrumbDivider>
            <ChevronRightRegular />
          </BreadcrumbDivider>
          <BreadcrumbItem>
            <BreadcrumbButton current={i === parts.length - 1}>{part}</BreadcrumbButton>
          </BreadcrumbItem>
        </React.Fragment>
      ))}
    </Breadcrumb>
  );
}

// ────────────────────────── StatusBar ──────────────────────────

/**
 * Slim footer: what is loaded, what the active tab derives from, validator
 * state and the current view mode. Navigation (Home) and per-configuration
 * actions live in the ActivityBar and the Explorer — the status bar used to
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
  const activeTabId = useAppStore(s => s.activeTabId);

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
      {fnoIngestStatus ? (
        <span className={styles.chip} title={fnoIngestStatus}>
          <ArrowSyncRegular fontSize={12} style={{ animation: 'spin 1.2s linear infinite' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{fnoIngestStatus}</span>
        </span>
      ) : (
        <span className={styles.info}>{t.statusConfigs(configs.length)}</span>
      )}

      {activeRelationship && (
        <span
          className={styles.chip}
          title={t.statusDerivedFromModelTitle(activeRelationship.kind, activeRelationship.parentName)}
        >
          <LinkRegular fontSize={12} />
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
            className={mergeClasses(styles.chip, styles.warnBtn, warnings.length === 0 ? styles.warnOk : styles.warnIssues)}
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
        <PopoverSurface className={styles.popover}>
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
