import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  makeStyles,
  tokens,
  mergeClasses,
  shorthands,
  Button,
  Tooltip,
  Badge,
  CounterBadge,
  Tag,
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
  Divider,
} from '@fluentui/react-components';
import {
  HomeRegular,
  ChevronRightRegular,
  ExpandUpRightRegular,
  ArrowMinimizeRegular,
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
import { t } from '../i18n';
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
    backgroundColor: tokens.colorNeutralBackground1,
  },
  shell: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
    animationName: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    animationDuration: '260ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  workarea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
  },
  main: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    animationName: {
      from: { opacity: 0, transform: 'translateX(-8px)' },
      to: { opacity: 1, transform: 'translateX(0)' },
    },
    animationDuration: '220ms',
    animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    animationFillMode: 'both',
  },
  sidebarRight: {
    borderRight: 'none',
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    animationName: {
      from: { opacity: 0, transform: 'translateX(8px)' },
      to: { opacity: 1, transform: 'translateX(0)' },
    },
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  panelContent: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    animationName: {
      from: { opacity: 0, transform: 'translateY(4px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    animationDuration: '260ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  resizeHandle: {
    width: '4px',
    backgroundColor: 'transparent',
    position: 'relative',
    cursor: 'col-resize',
    transitionProperty: 'background-color',
    transitionDuration: '160ms',
    ':hover': {
      backgroundColor: tokens.colorBrandBackground,
    },
    ':active': {
      backgroundColor: tokens.colorBrandBackgroundPressed,
    },
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
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
  },
  panelHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
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
    height: '28px',
    minHeight: '28px',
    backgroundColor: '#038387',
    backgroundImage: 'linear-gradient(90deg, #005b70 0%, #038387 50%, #37a987 100%)',
    color: '#ffffff',
    fontSize: tokens.fontSizeBase100,
    fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
    letterSpacing: '0.02em',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    flexShrink: 0,
    animationName: {
      from: { opacity: 0, transform: 'translateY(6px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    animationDuration: '260ms',
    animationDelay: '80ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  homeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForegroundOnBrand,
    border: 'none',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusSmall,
    cursor: 'pointer',
    transitionProperty: 'background-color, transform',
    transitionDuration: '160ms',
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.15)',
      transform: 'translateY(-1px)',
    },
  },
  info: {
    display: 'inline-flex',
    alignItems: 'center',
    opacity: 0.9,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px 2px 8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'rgba(255,255,255,0.15)',
    fontSize: tokens.fontSizeBase100,
    maxWidth: '240px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transitionProperty: 'background-color, transform',
    transitionDuration: '160ms',
    ':hover': {
      backgroundColor: 'rgba(255,255,255,0.25)',
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
  const styles = useAppStyles();
  const [showSearch, setShowSearch] = useState(false);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showLanding, setShowLanding] = useState(true);
  const [landingPinned, setLandingPinned] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusWarningsOpen, setStatusWarningsOpen] = useState(false);
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const activeTabId = useAppStore(s => s.activeTabId);
  const themeMode = useAppStore(s => s.themeMode);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const collapseAll = useAppStore(s => s.collapseAll);
  const expandAll = useAppStore(s => s.expandAll);
  const rebuildDerivedState = useAppStore(s => s.rebuildDerivedState);
  const requestExplorerExpand = useAppStore(s => s.requestExplorerExpand);
  const shouldAutoOpenFirstTabRef = useRef(false);
  const previousConfigCountRef = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (configs.length > 0 && treeNodes.length !== configs.length) {
      rebuildDerivedState();
    }
  }, [configs.length, treeNodes.length, rebuildDerivedState]);

  useEffect(() => {
    const previousCount = previousConfigCountRef.current;
    const addedConfigs = configs.length > previousCount;

    if (addedConfigs && showLanding) {
      shouldAutoOpenFirstTabRef.current = !activeTabId;
      setLandingPinned(false);
      setShowLanding(false);
    }

    previousConfigCountRef.current = configs.length;
  }, [configs.length, showLanding, activeTabId]);

  useEffect(() => {
    if (configs.length > 0 && showLanding && !landingPinned) {
      setShowLanding(false);
    }
  }, [configs.length, showLanding, landingPinned]);

  useEffect(() => {
    if (!shouldAutoOpenFirstTabRef.current || showLanding || activeTabId || treeNodes.length === 0) return;
    shouldAutoOpenFirstTabRef.current = false;
    navigateToTreeNode(treeNodes[0].id);
  }, [showLanding, activeTabId, treeNodes, navigateToTreeNode]);

  const isLandingVisible = showLanding || configs.length === 0;

  const handleFilesLoaded = useCallback(() => {
    shouldAutoOpenFirstTabRef.current = !activeTabId;
    setLandingPinned(false);
    setShowLanding(false);
  }, [activeTabId]);

  const toggleSearch = useCallback(() => {
    setShowSearch(s => {
      const next = !s;
      if (next) setShowRight(true);
      return next;
    });
  }, []);

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
        setShowRight(s => !s);
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
  }, [navigateBack, navigateForward, toggleSearch]);

  const paletteCommands = useMemo<CommandItem[]>(() => [
    { id: 'home', group: t.cmdGroupNav, label: t.cmdGoHome, action: () => { setLandingPinned(true); setShowLanding(true); } },
    { id: 'back', group: t.cmdGroupNav, label: t.cmdBack, hint: 'Alt+←', action: navigateBack },
    { id: 'forward', group: t.cmdGroupNav, label: t.cmdForward, hint: 'Alt+→', action: navigateForward },
    { id: 'search', group: t.cmdGroupView, label: t.cmdToggleSearch, hint: 'Ctrl+F', action: toggleSearch },
    { id: 'explorer', group: t.cmdGroupView, label: t.cmdToggleExplorer, hint: 'Ctrl+B', action: () => setShowLeft(s => !s) },
    { id: 'props', group: t.cmdGroupView, label: t.cmdToggleProperties, hint: 'Ctrl+J', action: () => setShowRight(s => !s) },
    { id: 'theme', group: t.cmdGroupView, label: t.cmdToggleTheme, action: () => setThemeMode(themeMode === 'dark' ? 'light' : 'dark') },
    { id: 'tech', group: t.cmdGroupView, label: t.cmdToggleTechnical, action: () => setShowTechnicalDetails(!showTechnicalDetails) },
    { id: 'collapse', group: t.cmdGroupTools, label: t.cmdCollapseAll, action: () => { collapseAll(); requestExplorerExpand('none'); } },
    { id: 'expand', group: t.cmdGroupTools, label: t.cmdExpandAll, action: () => { expandAll(); requestExplorerExpand('all'); } },
  ], [navigateBack, navigateForward, toggleSearch, setThemeMode, themeMode, setShowTechnicalDetails, showTechnicalDetails, collapseAll, expandAll, requestExplorerExpand]);

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
        showSearch={showSearch}
        onToggleLeft={() => setShowLeft(s => !s)}
        onToggleRight={() => setShowRight(s => !s)}
        onToggleSearch={toggleSearch}
        onGoHome={() => { setLandingPinned(true); setShowLanding(true); }}
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleWarnings={() => setStatusWarningsOpen(v => !v)}
        warningsOpen={statusWarningsOpen}
      />
      <div className={styles.workarea}>
        <Toolbar
          breadcrumb={<AppBreadcrumb onOpenHome={() => { setLandingPinned(true); setShowLanding(true); }} />}
        />
        <div className={styles.main}>
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
                    {showSearch ? (
                      <>
                        <PanelHeader
                          icon={<SearchRegular />}
                          title={t.search}
                          actions={
                            <Tooltip content={t.dismiss} relationship="label" withArrow>
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={<DismissRegular />}
                                onClick={() => setShowSearch(false)}
                                aria-label={t.dismiss}
                              />
                            </Tooltip>
                          }
                        />
                        <ErrorBoundary label="Search">
                          <SearchPanel />
                        </ErrorBoundary>
                      </>
                    ) : (
                      <>
                        <PanelHeader
                          icon={<AppsListDetailRegular />}
                          title={t.properties}
                        />
                        <div className={styles.panelContent}>
                          <ErrorBoundary label="Inspector">
                            <PropertyInspector />
                          </ErrorBoundary>
                        </div>
                      </>
                    )}
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
        <StatusBar
          onOpenLanding={() => setShowLanding(true)}
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

function ExplorerHeader() {
  const treeNodes = useAppStore(s => s.treeNodes);
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

  return (
    <div className={styles.root} role="status">
      <button type="button" className={styles.homeBtn} onClick={onOpenLanding} title={t.home}>
        <HomeRegular fontSize={14} />
        <span>{t.home}</span>
      </button>
      <span className={styles.info}>{t.statusConfigs(configs.length)}</span>

      {configs.map((c, i) => {
        const dir = getConfigDirectionLabel(c);
        return (
          <span
            key={i}
            className={styles.chip}
            title={`${c.solutionVersion.solution.name} v${c.solutionVersion.publicVersionNumber}${dir ? ` • ${dir}` : ''}`}
          >
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>{getConfigIcon(c)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.solutionVersion.solution.name.slice(0, 22)} v{c.solutionVersion.publicVersionNumber}
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
                  <Caption1>{w.message}</Caption1>
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
