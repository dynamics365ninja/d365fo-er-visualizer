import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
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

function getStatusConfigIcon(config: any): string {
  if (config.kind === 'DataModel') return '📐';
  if (config.kind === 'ModelMapping') return '🔗';
  if (config.content?.kind === 'Format') {
    return config.content.direction === ERDirection.Import ? '📥' : '📤';
  }
  return '📄';
}

function getStatusConfigSuffix(config: any): string {
  if (config.content?.kind !== 'Format') return '';
  return config.content.direction === ERDirection.Import ? ` • ${t.formatDirectionImport}` : ` • ${t.formatDirectionExport}`;
}

export function App() {
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

  // Show landing when no files loaded, or user manually navigates back
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

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const inEditable = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable);

      // Ctrl/Cmd+K — command palette (works even when focused in an input).
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(p => !p);
        return;
      }
      if (inEditable) return;

      // Ctrl/Cmd+F — focus search
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggleSearch();
        return;
      }
      // Ctrl/Cmd+B — toggle explorer
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setShowLeft(s => !s);
        return;
      }
      // Ctrl/Cmd+J — toggle properties
      if (mod && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setShowRight(s => !s);
        return;
      }
      // Alt+Left/Right — history
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
      <div className="app-landing-shell">
        <ErrorBoundary label="Landing">
          <LandingPage onFilesLoaded={handleFilesLoaded} />
        </ErrorBoundary>
        <ToastHost />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-root">
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
        <div className="app-workarea">
          <Toolbar
            breadcrumb={<Breadcrumb onOpenHome={() => { setLandingPinned(true); setShowLanding(true); }} />}
          />
          <div className="app-main app-main-shell">
            <PanelGroup direction="horizontal">
              {/* Left sidebar: Explorer */}
              {showLeft && (
                <>
                  <Panel defaultSize={22} minSize={15} maxSize={40}>
                    <div className="app-sidebar app-sidebar-left app-panel-shell app-panel-shell-left">
                      <ExplorerHeader />
                      <div className="app-panel-content">
                        <ErrorBoundary label="Explorer">
                          <ConfigExplorer />
                        </ErrorBoundary>
                      </div>
                    </div>
                  </Panel>
                  <PanelResizeHandle />
                </>
              )}

              {/* Center: Tabs + Designer */}
              <Panel defaultSize={showLeft && showRight ? 56 : showLeft || showRight ? 78 : 100} minSize={30}>
                <div className="app-center">
                  <TabBar />
                  <div className="app-panel-content app-center-content">
                    <ErrorBoundary label="Designer">
                      <DesignerView />
                    </ErrorBoundary>
                  </div>
                </div>
              </Panel>

              {/* Right sidebar: Properties + Search */}
              {showRight && (
                <>
                  <PanelResizeHandle />
                  <Panel defaultSize={22} minSize={15} maxSize={40}>
                    <div className="app-sidebar app-sidebar-right app-panel-shell app-panel-shell-right">
                      {showSearch ? (
                        <>
                          <div className="panel-header panel-header--rich panel-header-split">
                            <span className="panel-header__title"><span className="panel-header__icon">🔍</span>{t.search}</span>
                            <button
                              onClick={() => setShowSearch(false)}
                              className="panel-header-close"
                              aria-label={t.dismiss}
                            >✕</button>
                          </div>
                          <ErrorBoundary label="Search">
                            <SearchPanel />
                          </ErrorBoundary>
                        </>
                      ) : (
                        <>
                          <div className="panel-header panel-header--rich">
                            <span className="panel-header__title"><span className="panel-header__icon">📋</span>{t.properties}</span>
                          </div>
                          <div className="app-panel-content">
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

function StatusBar({ onOpenLanding, warningsOpen, setWarningsOpen }: {
  onOpenLanding: () => void;
  warningsOpen: boolean;
  setWarningsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const configs = useAppStore(s => s.configurations);
  const registry = useAppStore(s => s.registry);
  const warnings = useAppStore(s => s.warnings);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const removeConfiguration = useAppStore(s => s.removeConfiguration);

  return (
    <div className="app-statusbar">
      <span className="app-statusbar-home" onClick={onOpenLanding} title={t.home}>⌂ {t.home}</span>
      <span>{t.statusConfigs(configs.length)}</span>
      {configs.map((c, i) => (
        <span
          key={i}
          className="app-statusbar-chip app-statusbar-chip-closable"
          title={`${c.solutionVersion.solution.name} v${c.solutionVersion.publicVersionNumber}${getStatusConfigSuffix(c)}`}
        >
          <span>
            {getStatusConfigIcon(c)} {c.solutionVersion.solution.name.slice(0, 22)} v{c.solutionVersion.publicVersionNumber}{getStatusConfigSuffix(c)}
          </span>
          <button
            className="app-statusbar-chip-close"
            title={t.closeConfiguration}
            aria-label={t.closeConfiguration}
            onClick={event => {
              event.stopPropagation();
              removeConfiguration(i);
            }}
          >
            ×
          </button>
        </span>
      ))}
      <span
        className={`app-statusbar-chip app-statusbar-validator ${warnings.length === 0 ? 'app-statusbar-validator--ok' : 'app-statusbar-validator--issues'}`}
        onClick={() => warnings.length > 0 && setWarningsOpen(v => !v)}
        title={warnings.length === 0 ? t.validatorOk : t.validatorIssues(warnings.length)}
      >
        {warnings.length === 0 ? `✓ ${t.validatorOk}` : `! ${t.validatorIssues(warnings.length)}`}
      </span>
      <span className="app-statusbar-chip app-statusbar-mode-chip">
        {showTechnicalDetails ? t.technicalView : t.consultantView}
      </span>
      {showTechnicalDetails && <span className="app-statusbar-spacer">GUIDs: {registry.guidCount}</span>}
      {warningsOpen && warnings.length > 0 && (
        <div className="app-statusbar-warnings-popover" role="dialog" aria-label={t.warnings}>
          <div className="app-statusbar-warnings-header">
            <span>{t.warnings} ({warnings.length})</span>
            <button type="button" onClick={() => setWarningsOpen(false)} aria-label={t.dismiss}>×</button>
          </div>
          <ul className="app-statusbar-warnings-list">
            {warnings.map((w, i) => {
              const cfg = configs[w.configIndex];
              const cfgName = cfg ? cfg.solutionVersion.solution.name : `#${w.configIndex}`;
              return (
                <li key={i} className={`app-statusbar-warnings-item app-statusbar-warnings-item--${w.severity}`}>
                  <strong>{cfgName}</strong>
                  <span>{w.message}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Rich header for the Explorer panel: icon + title + item count + quick
 * collapse/expand actions. Replaces the plain uppercase label.
 */
function ExplorerHeader() {
  const treeNodes = useAppStore(s => s.treeNodes);
  const requestExplorerExpand = useAppStore(s => s.requestExplorerExpand);
  const expandAll = useAppStore(s => s.expandAll);
  const collapseAll = useAppStore(s => s.collapseAll);

  const handleExpand = () => {
    expandAll();
    requestExplorerExpand('all');
  };
  const handleCollapse = () => {
    collapseAll();
    requestExplorerExpand('none');
  };

  return (
    <div className="panel-header panel-header--rich">
      <span className="panel-header__title">
        <span className="panel-header__icon">📁</span>
        {t.explorer}
        {treeNodes.length > 0 && <span className="panel-header__count">{treeNodes.length}</span>}
      </span>
      <span className="panel-header__actions">
        <button
          type="button"
          className="panel-header__action"
          onClick={handleExpand}
          title={t.cmdExpandAll}
          aria-label={t.cmdExpandAll}
        >⊞</button>
        <button
          type="button"
          className="panel-header__action"
          onClick={handleCollapse}
          title={t.cmdCollapseAll}
          aria-label={t.cmdCollapseAll}
        >⊟</button>
      </span>
    </div>
  );
}

/**
 * Small breadcrumb strip showing the current active configuration & tab label.
 * Keeps orientation clear when many tabs are open.
 */
function Breadcrumb({ onOpenHome }: { onOpenHome: () => void }) {
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
    <nav className="app-breadcrumb" aria-label="breadcrumb">
      <button type="button" className="app-breadcrumb-home" onClick={onOpenHome} title={t.breadcrumbHome}>⌂</button>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <span className="app-breadcrumb-sep" aria-hidden="true">›</span>
          <span className={`app-breadcrumb-part${i === parts.length - 1 ? ' app-breadcrumb-part--last' : ''}`}>{part}</span>
        </React.Fragment>
      ))}
    </nav>
  );
}
