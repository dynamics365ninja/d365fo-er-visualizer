import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  makeStyles,
  tokens,
  mergeClasses,
  Button,
  Tooltip,
  CounterBadge,
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
  Subtitle2,
} from '@fluentui/react-components';
import {
  HomeRegular,
  ChevronRightRegular,
  ExpandUpRightRegular,
  ArrowMinimizeRegular,
  ArrowSyncRegular,
  DismissRegular,
  DocumentRegular,
  DocumentArrowDownRegular,
  DocumentArrowUpRegular,
  DataBarVerticalRegular,
  LinkRegular,
  WarningRegular,
  CheckmarkCircleRegular,
  FolderRegular,
  SearchRegular,
  AppsListDetailRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { ConfigExplorer } from './ConfigExplorer';
import { PropertyInspector } from './PropertyInspector';
import { Toolbar } from './Toolbar';
import { TabBar } from './TabBar';
import { DesignerView } from './DesignerView';
import { SearchPanel } from './SearchPanel';
import { LandingPage } from './LandingPage';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastHost } from './ToastHost';
import { CommandPalette, type CommandItem } from './CommandPalette';
import { ActivityBar } from './ActivityBar';
import { t, locale, useLocale } from '../i18n';
import { ERDirection } from '@er-visualizer/core';

// ────────────────────────── helpers ──────────────────────────

function getConfigIcon(config: any): React.ReactElement {
  if (config.kind === 'DataModel') return <DataBarVerticalRegular />;
  if (config.kind === 'ModelMapping') return <LinkRegular />;
  if (config.content?.kind === 'Format') {
    return config.content.direction === ERDirection.Import
      ? <DocumentArrowDownRegular />
      : <DocumentArrowUpRegular />;
  }
  return <DocumentRegular />;
}

function getConfigDirectionLabel(config: any): string {
  if (config.content?.kind !== 'Format') return '';
  return config.content.direction === ERDirection.Import
    ? t.formatDirectionImport
    : t.formatDirectionExport;
}

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
    backgroundImage: `linear-gradient(180deg, ${tokens.colorNeutralBackground1} 0%, ${tokens.colorNeutralBackground3} 100%)`,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
  },
  workarea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    padding: '8px 10px 10px 8px',
  },
  desktopFrame: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    overflow: 'hidden',
  },
  desktopTitleBar: {
    height: '36px',
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundImage: `linear-gradient(180deg, ${tokens.colorNeutralBackground3} 0%, ${tokens.colorNeutralBackground2} 100%)`,
    userSelect: 'none',
  },
  winDots: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    marginRight: '4px',
  },
  winDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    border: '1px solid rgba(0,0,0,0.22)',
  },
  titleBlock: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
  },
  titleText: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  },
  titleMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  titleSpacer: {
    flex: 1,
  },
  titlePill: {
    padding: '2px 8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground4,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase100,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  main: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: '0',
    gap: '0',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    backgroundColor: 'var(--bg-secondary)',
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '0',
    boxShadow: 'none',
    overflow: 'hidden',
  },
  sidebarRight: {
    borderRight: 'none',
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
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
    backgroundColor: 'var(--bg-primary)',
    borderRadius: '0',
    border: 'none',
    boxShadow: 'none',
    overflow: 'hidden',
  },
  panelContent: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    backgroundImage: 'none',
  },
  resizeHandle: {
    width: '10px',
    backgroundColor: 'transparent',
    backgroundImage: `linear-gradient(180deg, transparent 0 10px, ${tokens.colorNeutralStroke2} 10px calc(100% - 10px), transparent calc(100% - 10px) 100%)`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: '2px 100%',
    position: 'relative',
    cursor: 'col-resize',
    transitionProperty: 'background-image, background-size',
    transitionDuration: '160ms',
    borderRadius: '999px',
    ':hover': {
      backgroundImage: `linear-gradient(180deg, transparent 0 10px, ${tokens.colorBrandBackground} 10px calc(100% - 10px), transparent calc(100% - 10px) 100%)`,
      backgroundSize: '4px 100%',
    },
    ':active': {
      backgroundImage: `linear-gradient(180deg, transparent 0 10px, ${tokens.colorBrandBackgroundPressed} 10px calc(100% - 10px), transparent calc(100% - 10px) 100%)`,
      backgroundSize: '5px 100%',
    },
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    height: '42px',
    minHeight: '42px',
    flexShrink: 0,
    boxShadow: 'none',
  },
  panelHeaderTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
    letterSpacing: '0.03em',
  },
  panelHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  // Right panel tab strip
  rightTabStrip: {
    display: 'flex',
    alignItems: 'stretch',
    height: '36px',
    minHeight: '36px',
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  rightTab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '0 13px',
    border: 'none',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyBase,
    fontWeight: 400,
    cursor: 'pointer',
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    transitionProperty: 'color, border-bottom-color, background-color',
    transitionDuration: '140ms',
    ':hover': {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  rightTabActive: {
    color: tokens.colorNeutralForeground1,
    fontWeight: 600,
    borderBottomColor: tokens.colorBrandStroke1,
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
    gap: '8px',
    padding: '0 12px',
    height: '30px',
    minHeight: '30px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyBase,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
    boxShadow: 'none',
  },
  homeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForegroundOnBrand,
    border: 'none',
    padding: '3px 7px',
    height: '24px',
    borderRadius: tokens.borderRadiusSmall,
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
  },
  homeBtnIcon: {
    width: '16px',
    height: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    flexShrink: 0,
  },
  homeBtnLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    lineHeight: 1,
  },
  info: {
    display: 'inline-flex',
    alignItems: 'center',
    opacity: 0.92,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '1px 6px 1px 8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'rgba(255,255,255,0.16)',
    border: '1px solid rgba(255,255,255,0.2)',
    fontSize: tokens.fontSizeBase100,
    maxWidth: '240px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
  },
  chipClose: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    backgroundColor: 'transparent',
    color: 'inherit',
    border: 'none',
    borderRadius: tokens.borderRadiusSmall,
    cursor: 'pointer',
    padding: 0,
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.25)',
    },
  },
  spacer: { marginLeft: 'auto' },
  warnBtn: {
    cursor: 'pointer',
  },
  warnOk: {},
  warnIssues: {
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
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
  const [rightTab, setRightTab] = useState<'properties' | 'search'>('properties');
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusWarningsOpen, setStatusWarningsOpen] = useState(false);
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const themeMode = useAppStore(s => s.themeMode);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const collapseAll = useAppStore(s => s.collapseAll);
  const expandAll = useAppStore(s => s.expandAll);
  const rebuildDerivedState = useAppStore(s => s.rebuildDerivedState);
  const requestExplorerExpand = useAppStore(s => s.requestExplorerExpand);
  const fnoIngestStatus = useAppStore(s => s.fnoIngestStatus);
  const whereUsedTrigger = useAppStore(s => s.whereUsedTrigger);

  useEffect(() => {
    if (!whereUsedTrigger) return;
    setShowRight(true);
    setRightTab('search');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whereUsedTrigger?.version]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

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
      setShowRight(true);
    }
  }, [showRight, rightTab]);

  const toggleProperties = useCallback(() => {
    if (showRight && rightTab === 'properties') {
      setShowRight(false);
      setRightFullscreen(false);
    } else {
      setRightTab('properties');
      setShowRight(true);
    }
  }, [showRight, rightTab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  }, [navigateBack, navigateForward, toggleSearch, toggleProperties]);

  const paletteCommands = useMemo<CommandItem[]>(() => [
    { id: 'home', group: t.cmdGroupNav, label: t.cmdGoHome, action: () => { setShowLanding(true); } },
    { id: 'back', group: t.cmdGroupNav, label: t.cmdBack, hint: 'Alt+←', action: navigateBack },
    { id: 'forward', group: t.cmdGroupNav, label: t.cmdForward, hint: 'Alt+→', action: navigateForward },
    { id: 'search', group: t.cmdGroupView, label: t.cmdToggleSearch, hint: 'Ctrl+F', action: toggleSearch },
    { id: 'explorer', group: t.cmdGroupView, label: t.cmdToggleExplorer, hint: 'Ctrl+B', action: () => setShowLeft(s => !s) },
    { id: 'props', group: t.cmdGroupView, label: t.cmdToggleProperties, hint: 'Ctrl+J', action: toggleProperties },
    { id: 'theme', group: t.cmdGroupView, label: t.cmdToggleTheme, action: () => setThemeMode(themeMode === 'dark' ? 'light' : 'dark') },
    { id: 'tech', group: t.cmdGroupView, label: t.cmdToggleTechnical, action: () => setShowTechnicalDetails(!showTechnicalDetails) },
    { id: 'collapse', group: t.cmdGroupTools, label: t.cmdCollapseAll, action: () => { collapseAll(); requestExplorerExpand('none'); } },
    { id: 'expand', group: t.cmdGroupTools, label: t.cmdExpandAll, action: () => { expandAll(); requestExplorerExpand('all'); } },
  ], [navigateBack, navigateForward, toggleSearch, toggleProperties, setThemeMode, themeMode, setShowTechnicalDetails, showTechnicalDetails, collapseAll, expandAll, requestExplorerExpand, locale]);

  const activeTabLabel = useMemo(() => {
    const active = openTabs.find(tab => tab.id === activeTabId);
    return active?.label ?? null;
  }, [openTabs, activeTabId]);

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
        onToggleLeft={() => setShowLeft(s => !s)}
        onToggleRight={toggleProperties}
        onToggleSearch={toggleSearch}
        onGoHome={() => { setShowLanding(true); }}
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleWarnings={() => setStatusWarningsOpen(v => !v)}
        warningsOpen={statusWarningsOpen}
      />
      <div className={styles.workarea}>
        <div className={styles.desktopFrame}>
          <DesktopTitleBar
            activeLabel={activeTabLabel}
            configsCount={configs.length}
            rightTab={rightTab}
          />
          <Toolbar
            breadcrumb={<AppBreadcrumb onOpenHome={() => { setShowLanding(true); }} />}
          />
          <div className={styles.main}>
            {showRight && rightFullscreen ? (
              <div className={mergeClasses(styles.sidebar, styles.sidebarRight, styles.sidebarRightFullscreen)}>
                <RightPanel
                  tab={rightTab}
                  onTabChange={setRightTab}
                  fullscreen
                  onExpand={() => setRightFullscreen(true)}
                  onCollapse={() => setRightFullscreen(false)}
                  onClose={() => { setShowRight(false); setRightFullscreen(false); }}
                  panelContentClass={styles.panelContent}
                />
              </div>
            ) : (
              <PanelGroup direction="horizontal">
                {showLeft && (
                  <>
                    <Panel defaultSize={22} minSize={15} maxSize={40}>
                      <div className={styles.sidebar}>
                        <ExplorerHeader />
                        <div className={styles.panelContent}>
                          <ErrorBoundary label="Explorer">
                            <ConfigExplorer />
                          </ErrorBoundary>
                        </div>
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
                        <DesignerView />
                      </ErrorBoundary>
                    </div>
                  </div>
                </Panel>

                {showRight && (
                  <>
                    <PanelResizeHandle className={styles.resizeHandle} />
                    <Panel defaultSize={22} minSize={15} maxSize={40}>
                      <div className={mergeClasses(styles.sidebar, styles.sidebarRight)}>
                        <RightPanel
                          tab={rightTab}
                          onTabChange={setRightTab}
                          fullscreen={false}
                          onExpand={() => setRightFullscreen(true)}
                          onCollapse={() => setRightFullscreen(false)}
                          onClose={() => { setShowRight(false); setRightFullscreen(false); }}
                          panelContentClass={styles.panelContent}
                        />
                      </div>
                    </Panel>
                  </>
                )}
              </PanelGroup>
            )}
          </div>
          <StatusBar
            onOpenLanding={() => setShowLanding(true)}
            warningsOpen={statusWarningsOpen}
            setWarningsOpen={setStatusWarningsOpen}
          />
        </div>
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

function DesktopTitleBar({
  activeLabel,
  configsCount,
  rightTab,
}: {
  activeLabel: string | null;
  configsCount: number;
  rightTab: 'properties' | 'search';
}) {
  const styles = useAppStyles();
  return (
    <div className={styles.desktopTitleBar}>
      <span className={styles.winDots} aria-hidden>
        <span className={styles.winDot} style={{ backgroundColor: '#ff5f57' }} />
        <span className={styles.winDot} style={{ backgroundColor: '#febc2e' }} />
        <span className={styles.winDot} style={{ backgroundColor: '#28c840' }} />
      </span>
      <div className={styles.titleBlock}>
        <span className={styles.titleText}>{t.appName}</span>
        <span className={styles.titleMeta}>{activeLabel ?? t.selectElementHint}</span>
      </div>
      <span className={styles.titleSpacer} />
      <span className={styles.titlePill}>{configsCount} {t.statusConfigsWord}</span>
      <span className={styles.titlePill}>{rightTab === 'search' ? t.search : t.properties}</span>
    </div>
  );
}

// ────────────────────────── PanelHeader ──────────────────────────

function PanelHeader({ icon, title, count, actions }: {
  icon?: React.ReactNode;
  title: string;
  count?: number;
  actions?: React.ReactNode;
}) {
  const styles = useAppStyles();
  return (
    <div className={styles.panelHeader}>
      <div className={styles.panelHeaderTitle}>
        {icon && <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span>}
        <Subtitle2>{title}</Subtitle2>
        {typeof count === 'number' && count > 0 && (
          <CounterBadge count={count} size="small" appearance="filled" color="informative" />
        )}
      </div>
      {actions && <div className={styles.panelHeaderActions}>{actions}</div>}
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
}: {
  tab: 'properties' | 'search';
  onTabChange: (tab: 'properties' | 'search') => void;
  fullscreen: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
  panelContentClass: string;
}) {
  const styles = useAppStyles();
  return (
    <>
      <div className={styles.rightTabStrip} role="tablist">
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
      {tab === 'search' ? (
        <ErrorBoundary label="Search">
          <SearchPanel />
        </ErrorBoundary>
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

// ────────────────────────── ExplorerHeader ──────────────────────────

function ExplorerHeader() {  const treeNodes = useAppStore(s => s.treeNodes);
  const requestExplorerExpand = useAppStore(s => s.requestExplorerExpand);
  const expandAll = useAppStore(s => s.expandAll);
  const collapseAll = useAppStore(s => s.collapseAll);

  return (
    <PanelHeader
      icon={<FolderRegular />}
      title={t.explorer}
      count={treeNodes.length}
      actions={
        <>
          <Tooltip content={t.cmdExpandAll} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<ExpandUpRightRegular />}
              onClick={() => { expandAll(); requestExplorerExpand('all'); }}
              aria-label={t.cmdExpandAll}
            />
          </Tooltip>
          <Tooltip content={t.cmdCollapseAll} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowMinimizeRegular />}
              onClick={() => { collapseAll(); requestExplorerExpand('none'); }}
              aria-label={t.cmdCollapseAll}
            />
          </Tooltip>
        </>
      }
    />
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

function StatusBar({ onOpenLanding, warningsOpen, setWarningsOpen }: {
  onOpenLanding: () => void;
  warningsOpen: boolean;
  setWarningsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const styles = useStatusBarStyles();
  const configs = useAppStore(s => s.configurations);
  const registry = useAppStore(s => s.registry);
  const warnings = useAppStore(s => s.warnings);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const removeConfiguration = useAppStore(s => s.removeConfiguration);
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
      <button type="button" className={styles.homeBtn} onClick={onOpenLanding} title={t.home}>
        <span className={styles.homeBtnIcon} aria-hidden>
          <HomeRegular fontSize={14} />
        </span>
        <span className={styles.homeBtnLabel}>{t.home}</span>
      </button>

      {fnoIngestStatus ? (
        <span className={styles.chip} style={{
          fontStyle: 'italic',
          background: 'rgba(255,255,255,0.25)',
          animation: 'statusbar-pulse 1.6s ease-in-out infinite',
          fontWeight: 600,
        }} title={fnoIngestStatus}>
          <ArrowSyncRegular fontSize={12} style={{ animation: 'spin 1.2s linear infinite' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{fnoIngestStatus}</span>
        </span>
      ) : (
        <span className={styles.info}>{t.statusConfigs(configs.length)}</span>
      )}

      {activeRelationship && (
        <span
          className={styles.chip}
          style={{ backgroundColor: 'rgba(255,255,255,0.10)', gap: 4 }}
          title={locale === 'cs'
            ? `Aktivní konfigurace je ${activeRelationship.kind === 'Format' ? 'formát' : 'mapování'} odvozený z modelu "${activeRelationship.parentName}"`
            : `Active config is a ${activeRelationship.kind} derived from model "${activeRelationship.parentName}"`
          }
        >
          <LinkRegular fontSize={12} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
            {locale === 'cs' ? '→ model: ' : '→ model: '}{activeRelationship.parentName.slice(0, 28)}
          </span>
        </span>
      )}

      {configs.map((c, i) => {
        const dir = getConfigDirectionLabel(c);
        const version = c.solutionVersion.publicVersionNumber;
        const versionSuffix = version ? ` v${version}` : '';
        return (
          <span
            key={i}
            className={styles.chip}
            title={`${c.solutionVersion.solution.name}${versionSuffix}${dir ? ` • ${dir}` : ''}`}
          >
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>{getConfigIcon(c)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.solutionVersion.solution.name.slice(0, 22)}{versionSuffix}
              {dir ? ` • ${dir}` : ''}
            </span>
            <button
              type="button"
              className={styles.chipClose}
              title={t.closeConfiguration}
              aria-label={t.closeConfiguration}
              onClick={event => { event.stopPropagation(); removeConfiguration(i); }}
            >
              <DismissRegular fontSize={12} />
            </button>
          </span>
        );
      })}

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
      {showTechnicalDetails && <span className={styles.info}>GUIDs: {registry.guidCount}</span>}
    </div>
  );
}
