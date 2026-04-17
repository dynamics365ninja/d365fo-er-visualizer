import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../state/store';
import { ConfigExplorer } from './ConfigExplorer';
import { PropertyInspector } from './PropertyInspector';
import { Toolbar } from './Toolbar';
import { TabBar } from './TabBar';
import { DesignerView } from './DesignerView';
import { SearchPanel } from './SearchPanel';
import { LandingPage } from './LandingPage';
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
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const activeTabId = useAppStore(s => s.activeTabId);
  const themeMode = useAppStore(s => s.themeMode);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const rebuildDerivedState = useAppStore(s => s.rebuildDerivedState);
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

  if (isLandingVisible) {
    return (
      <div className="app-landing-shell">
        <LandingPage onFilesLoaded={handleFilesLoaded} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toolbar
        onToggleSearch={() => {
          setShowSearch(s => {
            const next = !s;
            // Ensure right panel is visible when opening search
            if (next) setShowRight(true);
            return next;
          });
        }}
        onToggleLeft={() => setShowLeft(s => !s)}
        onToggleRight={() => setShowRight(s => !s)}
        onGoHome={() => {
          setLandingPinned(true);
          setShowLanding(true);
        }}
        showLeft={showLeft}
        showRight={showRight}
      />
      <div className="app-main app-main-shell">
        <PanelGroup direction="horizontal">
          {/* Left sidebar: Explorer */}
          {showLeft && (
            <>
              <Panel defaultSize={22} minSize={15} maxSize={40}>
                <div className="app-sidebar app-sidebar-left app-panel-shell app-panel-shell-left">
                  <div className="panel-header">{t.explorer}</div>
                  <div className="app-panel-content">
                    <ConfigExplorer />
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
                <DesignerView />
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
                      <div className="panel-header panel-header-split">
                        <span>{t.search}</span>
                        <button
                          onClick={() => setShowSearch(false)}
                          className="panel-header-close"
                        >✕</button>
                      </div>
                      <SearchPanel />
                    </>
                  ) : (
                    <>
                      <div className="panel-header">{t.properties}</div>
                      <div className="app-panel-content">
                        <PropertyInspector />
                      </div>
                    </>
                  )}
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <StatusBar onOpenLanding={() => setShowLanding(true)} />
    </div>
  );
}

function StatusBar({ onOpenLanding }: { onOpenLanding: () => void }) {
  const configs = useAppStore(s => s.configurations);
  const registry = useAppStore(s => s.registry);
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
      <span className="app-statusbar-chip app-statusbar-mode-chip">
        {showTechnicalDetails ? t.technicalView : t.consultantView}
      </span>
      {showTechnicalDetails && <span className="app-statusbar-spacer">GUIDs: {registry.guidCount}</span>}
    </div>
  );
}
