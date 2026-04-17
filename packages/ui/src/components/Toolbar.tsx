import React, { useCallback, useRef } from 'react';
import { useAppStore } from '../state/store';
import { t } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

interface ToolbarProps {
  breadcrumb?: React.ReactNode;
}

/**
 * Slim top toolbar - focused on file/history operations. View-toggles, theme,
 * and palette were moved to the left ActivityBar so this bar stays clean.
 */
export function Toolbar({ breadcrumb }: ToolbarProps) {
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const canNavigateBack = useAppStore(s => s.canNavigateBack);
  const canNavigateForward = useAppStore(s => s.canNavigateForward);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const pushToast = useAppStore(s => s.pushToast);
  const configs = useAppStore(s => s.configurations);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reportLoadErrors = useCallback((errors: string[]) => {
    for (const err of errors) {
      pushToast({ kind: 'error', message: err });
    }
  }, [pushToast]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const result = await loadBrowserFiles(e.target.files, loadXmlFile);
    if (result.errors.length > 0) reportLoadErrors(result.errors);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [loadXmlFile, reportLoadErrors]);

  const handleOpenFiles = useCallback(async () => {
    const result = await openFilesWithSystemDialog(loadXmlFile);
    if (result == null) {
      fileInputRef.current?.click();
      return;
    }
    if (result.errors.length > 0) reportLoadErrors(result.errors);
  }, [loadXmlFile, reportLoadErrors]);

  return (
    <div className="toolbar toolbar--slim">
      <div className="toolbar__nav">
        <IconButton onClick={navigateBack} icon="←" label={t.back} disabled={!canNavigateBack} shortcut="Alt+←" />
        <IconButton onClick={navigateForward} icon="→" label={t.forward} disabled={!canNavigateForward} shortcut="Alt+→" />
      </div>

      <div className="toolbar__sep" aria-hidden="true" />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".xml"
        onChange={handleFileSelect}
        className="toolbar-file-input"
        id="file-input"
      />
      <button type="button" className="toolbar__primary" onClick={handleOpenFiles} title={t.loadXml}>
        <span aria-hidden="true">📂</span>
        <span>{t.loadXml}</span>
      </button>

      <div className="toolbar__sep" aria-hidden="true" />

      <div className="toolbar__breadcrumb">{breadcrumb}</div>

      <div className="toolbar__right">
        {configs.length > 0 && (
          <span className="toolbar__count" title={t.statusConfigs(configs.length)}>
            {configs.length} <span className="toolbar__count-word">{t.statusConfigsWord}</span>
          </span>
        )}
        <span className={`toolbar__mode${showTechnicalDetails ? ' toolbar__mode--tech' : ''}`}>
          {showTechnicalDetails ? t.technicalView : t.consultantView}
        </span>
      </div>
    </div>
  );
}

function IconButton({ onClick, icon, label, disabled = false, shortcut }: { onClick: () => void; icon: string; label: string; disabled?: boolean; shortcut?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="toolbar__icon-btn"
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}
