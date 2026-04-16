import React, { useCallback, useRef } from 'react';
import { useAppStore } from '../state/store';
import { t } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

interface ToolbarProps {
  onToggleSearch: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onGoHome: () => void;
  showLeft: boolean;
  showRight: boolean;
}

export function Toolbar({ onToggleSearch, onToggleLeft, onToggleRight, onGoHome, showLeft, showRight }: ToolbarProps) {
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);
  const canNavigateBack = useAppStore(s => s.canNavigateBack);
  const navigateBack = useAppStore(s => s.navigateBack);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const result = await loadBrowserFiles(e.target.files, loadXmlFile);
    if (result.errors.length > 0) {
      alert(result.errors.join('\n'));
    }

    // Reset so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [loadXmlFile]);

  const handleOpenFiles = useCallback(async () => {
    const result = await openFilesWithSystemDialog(loadXmlFile);
    if (result == null) {
      fileInputRef.current?.click();
      return;
    }

    if (result.errors.length > 0) {
      alert(result.errors.join('\n'));
    }
  }, [loadXmlFile]);

  return (
    <div className="toolbar">
      <ToolbarButton onClick={navigateBack} icon="←" label={t.back} disabled={!canNavigateBack} />

      <div className="toolbar-divider" />

      <button
        onClick={onGoHome}
        title={t.home}
        className="toolbar-home"
      >
        <span className="toolbar-home-icon">⚡</span>
        <span className="toolbar-home-copy">
          <span className="toolbar-home-kicker">Workspace</span>
          <span className="toolbar-home-title">ER Visualizer</span>
        </span>
      </button>

      <div className="toolbar-divider" />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".xml"
        onChange={handleFileSelect}
        className="toolbar-file-input"
        id="file-input"
      />
      <ToolbarButton onClick={handleOpenFiles} icon="📂" label={t.loadXml} />
      <ToolbarButton onClick={onToggleSearch} icon="🔍" label={`${t.search} / ${t.whereUsed}`} />

      <div className="toolbar-section">
        <ToolbarToggle onClick={onToggleLeft} icon="▧" label={t.explorer} active={showLeft} />
        <ToolbarToggle onClick={onToggleRight} icon="▨" label={t.properties} active={showRight} />
        <ToolbarToggle
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
          icon="☰"
          label={showTechnicalDetails ? t.hideDetails : t.showDetails}
          active={showTechnicalDetails}
        />
      </div>

      <div className="toolbar-spacer" />
      <span className={`toolbar-mode-badge${showTechnicalDetails ? ' toolbar-mode-badge-technical' : ''}`}>
        {showTechnicalDetails ? t.technicalView : t.consultantView}
      </span>
      <span className="toolbar-subtitle">{t.appSubtitle}</span>
    </div>
  );
}

function ToolbarButton({ onClick, icon, label, disabled = false }: { onClick: () => void; icon: string; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="toolbar-button"
      disabled={disabled}
    >
      <span className="toolbar-button-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ToolbarToggle({ onClick, icon, label, active }: { onClick: () => void; icon: string; label: string; active: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`toolbar-toggle${active ? ' toolbar-toggle-active' : ''}`}
    >
      <span className="toolbar-button-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
