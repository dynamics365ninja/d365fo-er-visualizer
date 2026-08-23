import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Tooltip,
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowCounterclockwiseRegular,
  CloudArrowDownRegular,
  DeleteRegular,
  DismissRegular,
  DismissSquareMultipleRegular,
  FolderOpenRegular,
  OpenRegular,
  SearchRegular,
} from '@fluentui/react-icons';
import { findRelatedRecentFiles, useAppStore, type RecentFile } from '../state/store';
import { t, useLocale } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';
import { buildExplorerModelGroups, getBestVersion, type ExplorerModelGroup } from '../utils/model-hierarchy';
import {
  DependencyKindIcon,
  DependencyPromptDialog,
  dependencyKindLabel,
  type DependencyPromptRequest,
} from './DependencyPromptDialog';

const kindAccent: Record<string, string> = {
  DataModel: 'model',
  ModelMapping: 'mapping',
  Format: 'format',
};

function KindPill({ kind }: { kind: string | undefined }) {
  return (
    <span className={`ws-kind ws-kind--${kindAccent[kind ?? ''] ?? 'unknown'}`}>
      <DependencyKindIcon kind={kind} />
      {dependencyKindLabel(kind)}
    </span>
  );
}

function SourcePill({ source, path }: { source: RecentFile['source'] | undefined; path: string }) {
  const isFno = source === 'fno' || path.startsWith('fno://');
  return (
    <span className={`ws-source ws-source--${isFno ? 'fno' : 'file'}`} title={path}>
      {isFno ? t.workspaceSourceFno : t.workspaceSourceFile}
    </span>
  );
}

function matches(query: string, ...parts: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return parts.some(p => p && p.toLowerCase().includes(q));
}

/**
 * Workspace manager — the single place where the user sees exactly which
 * configurations are loaded (grouped by data model), adds more (files, F&O,
 * or cached entries that were closed earlier) and closes individual entries.
 * Re-adding a format or mapping offers its related model + mapping.
 */
export function WorkspaceManager({
  open,
  onOpenChange,
  onRequestFno,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigate to the F&O download panel (landing page → remote tab). */
  onRequestFno?: () => void;
}) {
  useLocale();
  const configurations = useAppStore(s => s.configurations);
  const recentFiles = useAppStore(s => s.recentFiles);
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const loadCachedFile = useAppStore(s => s.loadCachedFile);
  const closeConfigurationWithUndo = useAppStore(s => s.closeConfigurationWithUndo);
  const removeAllConfigurations = useAppStore(s => s.removeAllConfigurations);
  const removeRecentFile = useAppStore(s => s.removeRecentFile);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const pushToast = useAppStore(s => s.pushToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [prompt, setPrompt] = useState<(DependencyPromptRequest & { subject: RecentFile }) | null>(null);

  const loadedPaths = useMemo(() => new Set(configurations.map(c => c.filePath)), [configurations]);
  const available = useMemo(
    () => recentFiles.filter(r => {
      if (loadedPaths.has(r.path)) return false;
      return cachedPaths.has(r.path) || (r.bundlePath ? cachedPaths.has(r.bundlePath) : false);
    }),
    [recentFiles, loadedPaths, cachedPaths],
  );

  const hierarchy = useMemo(() => buildExplorerModelGroups(configurations), [configurations]);

  const counts = useMemo(() => {
    const c = { DataModel: 0, ModelMapping: 0, Format: 0 };
    for (const cfg of configurations) c[cfg.content.kind as keyof typeof c] += 1;
    return c;
  }, [configurations]);

  const addCached = useCallback((entry: RecentFile) => {
    const related = findRelatedRecentFiles(entry, recentFiles, configurations, cachedPaths);
    const candidates = [
      ...(related.dataModel ? [related.dataModel] : []),
      ...related.mappings,
      ...related.formats,
    ];
    if (candidates.length === 0 || entry.kind === undefined) {
      void loadCachedFile(entry.path, entry.solutionName ?? entry.name);
      return;
    }
    setPrompt({
      subject: entry,
      subjectName: entry.solutionName ?? entry.name,
      subjectKind: entry.kind,
      candidates: candidates.map(c => ({
        key: c.path,
        kind: c.kind ?? 'Format',
        name: c.solutionName ?? c.name,
        meta: c.version ? `v${c.version}` : undefined,
      })),
    });
  }, [recentFiles, configurations, cachedPaths, loadCachedFile]);

  const loadMany = useCallback(async (entries: RecentFile[]) => {
    // Data models first so mappings/formats link to them on arrival.
    const order = (k: string | undefined) => (k === 'DataModel' ? 0 : k === 'ModelMapping' ? 1 : 2);
    const sorted = [...entries].sort((a, b) => order(a.kind) - order(b.kind));
    for (const e of sorted) await loadCachedFile(e.path, e.solutionName ?? e.name);
  }, [loadCachedFile]);

  const openInTab = useCallback((configIndex: number) => {
    navigateToTreeNode(`cfg-${configIndex}`);
    onOpenChange(false);
  }, [navigateToTreeNode, onOpenChange]);

  const filteredAvailable = available.filter(r => matches(query, r.solutionName, r.name, r.path, r.version));

  const renderLoadedRow = (idx: number, depth: number) => {
    const cfg = configurations[idx];
    if (!cfg) return null;
    const name = cfg.solutionVersion.solution.name || cfg.filePath;
    if (!matches(query, name, cfg.filePath)) return null;
    const version = getBestVersion(cfg);
    const recent = recentFiles.find(r => r.path === cfg.filePath);
    return (
      <li key={cfg.filePath} className={`ws-row ws-row--${kindAccent[cfg.content.kind]}`} style={{ ['--ws-depth' as string]: depth }}>
        <KindPill kind={cfg.content.kind} />
        <span className="ws-row-body">
          <span className="ws-row-name" title={name}>{name}</span>
          <span className="ws-row-meta">
            {version && <span className="ws-version">v{version}</span>}
            <SourcePill source={recent?.source} path={cfg.filePath} />
            <span className="ws-path" title={cfg.filePath}>{cfg.filePath.replace(/^fno:\/\/[^/]+\//, '')}</span>
          </span>
        </span>
        <span className="ws-row-actions">
          <Tooltip content={t.explorerOpenInTab} relationship="label">
            <Button appearance="subtle" size="small" icon={<OpenRegular />} onClick={() => openInTab(idx)} />
          </Tooltip>
          <Tooltip content={t.closeConfiguration} relationship="label">
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={() => closeConfigurationWithUndo(idx)} />
          </Tooltip>
        </span>
      </li>
    );
  };

  const renderGroup = (group: ExplorerModelGroup, depth: number): React.ReactNode => {
    const rows = [
      renderLoadedRow(group.configIdx, depth),
      ...group.children.map(idx => renderLoadedRow(idx, depth + 1)),
      ...group.subModels.map(sub => renderGroup(sub, depth + 1)),
    ].filter(Boolean);
    if (rows.length === 0) return null;
    return <React.Fragment key={`g-${group.configIdx}`}>{rows}</React.Fragment>;
  };

  const loadedRows = [
    ...hierarchy.roots.map(g => renderGroup(g, 0)),
    ...(hierarchy.orphans.length > 0
      ? [
        <li key="orphan-head" className="ws-subhead">{t.workspaceUnlinked}</li>,
        ...hierarchy.orphans.map(idx => renderLoadedRow(idx, 0)),
      ]
      : []),
  ].filter(Boolean);

  return (
    <>
      <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
        <DialogSurface className="ws-surface">
          <DialogBody>
            <DialogTitle>
              <span className="ws-title">
                {t.workspaceManager}
                <span className="ws-title-counts">
                  <span className="ws-count ws-count--model" title={dependencyKindLabel('DataModel')}>{counts.DataModel}</span>
                  <span className="ws-count ws-count--mapping" title={dependencyKindLabel('ModelMapping')}>{counts.ModelMapping}</span>
                  <span className="ws-count ws-count--format" title={dependencyKindLabel('Format')}>{counts.Format}</span>
                </span>
              </span>
            </DialogTitle>
            <DialogContent>
              <div className="ws-toolbar">
                <Input
                  size="small"
                  className="ws-filter"
                  value={query}
                  onChange={(_, d) => setQuery(d.value)}
                  placeholder={t.workspaceFilterPlaceholder}
                  contentBefore={<SearchRegular fontSize={14} />}
                  contentAfter={query ? (
                    <Button appearance="transparent" size="small" icon={<DismissRegular />} aria-label={t.clearFilter} onClick={() => setQuery('')} />
                  ) : undefined}
                />
                <Button
                  appearance="secondary"
                  size="small"
                  icon={<FolderOpenRegular />}
                  onClick={() => {
                    void openFilesWithSystemDialog(loadXmlFile).then(result => {
                      if (result === null) fileInputRef.current?.click();
                    });
                  }}
                >
                  {t.workspaceAddFiles}
                </Button>
                {onRequestFno && (
                  <Button appearance="secondary" size="small" icon={<CloudArrowDownRegular />} onClick={() => { onOpenChange(false); onRequestFno(); }}>
                    {t.workspaceAddFromFno}
                  </Button>
                )}
              </div>

              <div className="ws-section-head">
                <span>{t.workspaceLoaded}</span>
                <span className="ws-count">{configurations.length}</span>
                <span className="ws-section-spacer" />
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DismissSquareMultipleRegular />}
                  disabled={configurations.length === 0}
                  onClick={removeAllConfigurations}
                >
                  {t.closeAllConfigurations}
                </Button>
              </div>
              {configurations.length === 0 ? (
                <p className="ws-empty">{t.workspaceEmpty}</p>
              ) : loadedRows.length === 0 ? (
                <p className="ws-empty">{t.workspaceNoMatch}</p>
              ) : (
                <ul className="ws-list">{loadedRows}</ul>
              )}

              <div className="ws-section-head ws-section-head--spaced">
                <span>{t.workspaceAvailable}</span>
                <span className="ws-count">{available.length}</span>
                <span className="ws-section-spacer" />
                {available.length > 0 && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<ArrowCounterclockwiseRegular />}
                    onClick={() => { void loadMany(available); }}
                  >
                    {t.workspaceReopenAll}
                  </Button>
                )}
              </div>
              {available.length === 0 ? (
                <p className="ws-empty">{t.workspaceAvailableEmpty}</p>
              ) : filteredAvailable.length === 0 ? (
                <p className="ws-empty">{t.workspaceNoMatch}</p>
              ) : (
                <ul className="ws-list ws-list--available">
                  {filteredAvailable.map(rf => (
                    <li key={rf.path} className={`ws-row ws-row--${kindAccent[rf.kind ?? ''] ?? 'unknown'}`}>
                      <KindPill kind={rf.kind} />
                      <span className="ws-row-body">
                        <span className="ws-row-name" title={rf.solutionName ?? rf.name}>{rf.solutionName ?? rf.name}</span>
                        <span className="ws-row-meta">
                          {rf.version && <span className="ws-version">v{rf.version}</span>}
                          <SourcePill source={rf.source} path={rf.path} />
                          <span className="ws-path" title={rf.path}>{rf.name}</span>
                        </span>
                      </span>
                      <span className="ws-row-actions">
                        <Tooltip content={t.workspaceAdd} relationship="label">
                          <Button appearance="primary" size="small" icon={<AddRegular />} onClick={() => addCached(rf)} />
                        </Tooltip>
                        <Tooltip content={t.workspaceRemoveFromCache} relationship="label">
                          <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={() => removeRecentFile(rf.path)} />
                        </Tooltip>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="ws-hint">{t.workspaceClosedHint}</p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xml"
                multiple
                style={{ display: 'none' }}
                onChange={e => {
                  void loadBrowserFiles(e.target.files, loadXmlFile).then(({ errors }) => {
                    for (const err of errors) pushToast({ kind: 'error', message: err });
                  });
                  e.target.value = '';
                }}
              />
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => onOpenChange(false)}>
                {t.workspaceClose}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <DependencyPromptDialog
        request={prompt}
        onConfirm={keys => {
          const subject = prompt!.subject;
          const picked = recentFiles.filter(r => keys.includes(r.path));
          setPrompt(null);
          void loadMany([subject, ...picked]);
        }}
        onOnlySubject={() => {
          const subject = prompt!.subject;
          setPrompt(null);
          void loadCachedFile(subject.path, subject.solutionName ?? subject.name);
        }}
        onCancel={() => setPrompt(null)}
      />
    </>
  );
}

