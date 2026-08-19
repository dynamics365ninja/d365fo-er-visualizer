import React, { useRef } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import {
  AddRegular,
  DismissRegular,
  DismissSquareMultipleRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { locale, t } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

const kindClass: Record<string, string> = {
  DataModel: 'ws-kind ws-kind--model',
  ModelMapping: 'ws-kind ws-kind--mapping',
  Format: 'ws-kind ws-kind--format',
};

function kindLabel(kind: string | undefined): string {
  if (locale === 'cs') {
    return kind === 'DataModel' ? 'Model' : kind === 'ModelMapping' ? 'Mapování' : kind === 'Format' ? 'Formát' : '?';
  }
  return kind === 'DataModel' ? 'Model' : kind === 'ModelMapping' ? 'Mapping' : kind === 'Format' ? 'Format' : '?';
}

/**
 * Workspace manager — the single place where the user sees exactly which
 * configurations are loaded, adds more (files or cached recents) without
 * losing the current set, and closes individual entries.
 */
export function WorkspaceManager({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const configurations = useAppStore(s => s.configurations);
  const recentFiles = useAppStore(s => s.recentFiles);
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const loadCachedFile = useAppStore(s => s.loadCachedFile);
  const removeConfiguration = useAppStore(s => s.removeConfiguration);
  const removeAllConfigurations = useAppStore(s => s.removeAllConfigurations);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadedPaths = new Set(configurations.map(c => c.filePath));
  const addable = recentFiles.filter(r => cachedPaths.has(r.path) && !loadedPaths.has(r.path));

  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      <DialogSurface className="ws-surface">
        <DialogBody>
          <DialogTitle>{t.workspaceManager}</DialogTitle>
          <DialogContent>
            <div className="ws-section-head">
              <span>{t.workspaceLoaded}</span>
              <span className="ws-count">{configurations.length}</span>
            </div>
            {configurations.length === 0 ? (
              <p className="ws-empty">{t.workspaceEmpty}</p>
            ) : (
              <ul className="ws-list">
                {configurations.map((cfg, i) => (
                  <li key={cfg.filePath} className="ws-row">
                    <span className={kindClass[cfg.content.kind] ?? 'ws-kind'}>
                      {kindLabel(cfg.content.kind)}
                    </span>
                    <span className="ws-row-body">
                      <span className="ws-row-name">{cfg.solutionVersion.solution.name}</span>
                      <span className="ws-row-meta">
                        v{cfg.solutionVersion.publicVersionNumber || '–'} · {cfg.filePath}
                      </span>
                    </span>
                    <Button
                      appearance="transparent"
                      size="small"
                      icon={<DismissRegular />}
                      aria-label={t.closeConfiguration}
                      title={t.closeConfiguration}
                      onClick={() => removeConfiguration(i)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {addable.length > 0 && (
              <>
                <div className="ws-section-head ws-section-head--spaced">
                  <span>{t.workspaceAddRecent}</span>
                </div>
                <ul className="ws-list">
                  {addable.map(rf => (
                    <li key={rf.path} className="ws-row">
                      <span className={kindClass[rf.kind ?? ''] ?? 'ws-kind'}>
                        {kindLabel(rf.kind)}
                      </span>
                      <span className="ws-row-body">
                        <span className="ws-row-name">{rf.name}</span>
                        <span className="ws-row-meta">{rf.path}</span>
                      </span>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<AddRegular />}
                        aria-label={t.workspaceAdd}
                        title={t.workspaceAdd}
                        onClick={() => void loadCachedFile(rf.path, rf.name)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              multiple
              style={{ display: 'none' }}
              onChange={e => {
                void loadBrowserFiles(e.target.files, loadXmlFile);
                e.target.value = '';
              }}
            />
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              icon={<FolderOpenRegular />}
              onClick={() => {
                void openFilesWithSystemDialog(loadXmlFile).then(result => {
                  if (result === null) fileInputRef.current?.click();
                });
              }}
            >
              {t.workspaceAddFiles}
            </Button>
            <Button
              appearance="secondary"
              icon={<DismissSquareMultipleRegular />}
              disabled={configurations.length === 0}
              onClick={removeAllConfigurations}
            >
              {t.closeAllConfigurations}
            </Button>
            <Button appearance="primary" onClick={() => onOpenChange(false)}>
              {t.workspaceClose}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
