import React, { useCallback, useState } from 'react';
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

export function App() {
  const [showSearch, setShowSearch] = useState(false);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showLanding, setShowLanding] = useState(true);
  const configs = useAppStore(s => s.configurations);

  // Show landing when no files loaded, or user manually navigates back
  const isLandingVisible = showLanding || configs.length === 0;

  const handleFilesLoaded = useCallback(() => {
    setShowLanding(false);
  }, []);

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
        onGoHome={() => setShowLanding(true)}
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

  return (
    <div className="app-statusbar">
      <span className="app-statusbar-home" onClick={onOpenLanding} title={t.home}>⌂ {t.home}</span>
      <span>{t.statusConfigs(configs.length)}</span>
      {configs.map((c, i) => (
        <span key={i} className="app-statusbar-chip">
          {c.kind === 'DataModel' ? '📐' : c.kind === 'ModelMapping' ? '🔗' : '📄'} {c.solutionVersion.solution.name.slice(0, 25)}
        </span>
      ))}
      <span className="app-statusbar-spacer">GUIDs: {registry.guidCount}</span>
    </div>
  );
}
