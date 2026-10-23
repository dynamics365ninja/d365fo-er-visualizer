import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Tooltip,
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowLeftRegular,
  ArrowRightRegular,
  BranchCompareRegular,
  CloudArrowDownRegular,
  DeleteRegular,
  DismissRegular,
  DismissSquareMultipleRegular,
  FolderOpenRegular,
  OpenRegular,
  SearchRegular,
} from '@fluentui/react-icons';
import type { ERConfiguration } from '@er-visualizer/core';
import {
  compareConfigVersions,
  findRelatedRecentFiles,
  normalizeSolutionId,
  useAppStore,
  type RecentFile,
} from '../state/store';
import { t, useLocale } from '../i18n';
import { describeRecent } from '../utils/recent-display';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';
import { useResizableDialog } from '../utils/resizable-dialog';
import { buildExplorerModelGroups, getBestVersion, type ExplorerModelGroup } from '../utils/model-hierarchy';
import { DependencyKindIcon, dependencyKindLabel } from './DependencyPromptDialog';
import { useRelatedRecentLoad } from './useRelatedRecentLoad';

const kindAccent: Record<string, string> = {
  DataModel: 'model',
  ModelMapping: 'mapping',
  Format: 'format',
};

const KIND_ORDER = ['DataModel', 'ModelMapping', 'Format'] as const;

function KindIcon({ kind }: { kind: string | undefined }) {
  return (
    <span className={`ws-kind-icon ws-kind-icon--${kindAccent[kind ?? ''] ?? 'unknown'}`} title={dependencyKindLabel(kind)}>
      <DependencyKindIcon kind={kind} />
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

/**
 * Where a configuration came from, when it adds to its name: the F&O host, the
 * bundle it was extracted from, or a file name that is not just the name again.
 * The synthetic `fno://…` key used to show here verbatim.
 */
function Origin({ path, recent }: { path: string; recent?: RecentFile }) {
  const display = describeRecent(recent ?? { path, name: path.split(/[\\/]/).pop() ?? path, openedAt: 0 });
  if (!display.origin) return null;
  return <span className="ws-path" title={path}>{display.origin}</span>;
}

function matches(query: string, ...parts: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return parts.some(p => p && p.toLowerCase().includes(q));
}

/** One configuration across its versions: the same solution GUID and kind. */
function recentKey(file: RecentFile): string {
  return `${file.kind ?? '?'}:${file.solutionId || (file.solutionName ?? file.name).toLowerCase()}`;
}

function configKey(cfg: ERConfiguration): string {
  return `${cfg.content.kind}:${normalizeSolutionId(cfg.solutionVersion.solution.id) || cfg.solutionVersion.solution.name.toLowerCase()}`;
}

const nameOf = (file: RecentFile) => describeRecent(file).title;

/** A cached configuration that is not loaded, with every version of it in the cache. */
interface AvailableGroup {
  key: string;
  kind: RecentFile['kind'];
  name: string;
  /** Newest first. */
  versions: RecentFile[];
  /** The version of it the workspace has loaded, if any. */
  loadedVersion?: string;
}

/**
 * Workspace manager — the configurations the browser cache holds on the left,
 * every cached version of each; the workspace on the right. Picking a
 * configuration (or one of its versions) moves it to the load list on the
 * right, and one button loads the whole list. A version of a configuration
 * that is already loaded takes that one's place.
 */
/** Smallest workspace dialog that still shows both columns side by side. */
const WS_DIALOG_MIN_W = 460;
const WS_DIALOG_MIN_H = 300;
const WS_DIALOG_SIZE_KEY = 'er-visualizer.workspace.dialogSize';

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
  const { surfaceRef, size: dialogSize, startResize, resetSize } = useResizableDialog(
    { storageKey: WS_DIALOG_SIZE_KEY, minWidth: WS_DIALOG_MIN_W, minHeight: WS_DIALOG_MIN_H },
    open,
  );
  const configurations = useAppStore(s => s.configurations);
  const recentFiles = useAppStore(s => s.recentFiles);
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const removeConfiguration = useAppStore(s => s.removeConfiguration);
  const closeConfigurationWithUndo = useAppStore(s => s.closeConfigurationWithUndo);
  const closeAllConfigurationsWithUndo = useAppStore(s => s.closeAllConfigurationsWithUndo);
  const removeRecentFile = useAppStore(s => s.removeRecentFile);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const pushToast = useAppStore(s => s.pushToast);
  const openVersionComparePicker = useAppStore(s => s.openVersionComparePicker);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // Paths picked for loading, in the order they were picked.
  const [staged, setStaged] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { loadMany } = useRelatedRecentLoad();

  const loadedPaths = useMemo(() => new Set(configurations.map(c => c.filePath)), [configurations]);
  /** Loaded configurations by `configKey` — where a picked version would go. */
  const loadedByKey = useMemo(() => {
    const map = new Map<string, number>();
    configurations.forEach((cfg, index) => map.set(configKey(cfg), index));
    return map;
  }, [configurations]);

  const available = useMemo(
    () => recentFiles.filter(r => {
      if (loadedPaths.has(r.path)) return false;
      return cachedPaths.has(r.path) || (r.bundlePath ? cachedPaths.has(r.bundlePath) : false);
    }),
    [recentFiles, loadedPaths, cachedPaths],
  );

  // A picked entry that was loaded or dropped from the cache meanwhile is no
  // longer something to load.
  const stagedEntries = useMemo(() => {
    const byPath = new Map(available.map(r => [r.path, r]));
    return staged.map(path => byPath.get(path)).filter((r): r is RecentFile => Boolean(r));
  }, [available, staged]);
  const stagedPaths = useMemo(() => new Set(stagedEntries.map(r => r.path)), [stagedEntries]);
  const stagedKeys = useMemo(() => new Set(stagedEntries.map(recentKey)), [stagedEntries]);

  const groups = useMemo(() => {
    const byKey = new Map<string, AvailableGroup>();
    for (const file of available) {
      if (stagedPaths.has(file.path)) continue;
      const key = recentKey(file);
      let group = byKey.get(key);
      if (!group) {
        const loadedIndex = loadedByKey.get(key);
        group = {
          key,
          kind: file.kind,
          name: nameOf(file),
          versions: [],
          loadedVersion: loadedIndex != null ? getBestVersion(configurations[loadedIndex]) : undefined,
        };
        byKey.set(key, group);
      }
      group.versions.push(file);
    }
    for (const group of byKey.values()) group.versions.sort((a, b) => compareConfigVersions(b.version, a.version));
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [available, stagedPaths, loadedByKey, configurations]);

  const filteredGroups = groups
    .map(group => (matches(query, group.name)
      ? group
      : { ...group, versions: group.versions.filter(r => matches(query, r.name, r.path, r.version)) }))
    .filter(group => group.versions.length > 0);

  // Data models and mappings the picked configurations work with, offered —
  // not added — next to the load list: which mapping a format runs on is not
  // always certain, so the choice stays with the user.
  const related = useMemo(() => {
    const out = new Map<string, RecentFile>();
    for (const entry of stagedEntries) {
      const found = findRelatedRecentFiles(entry, recentFiles, configurations, cachedPaths);
      for (const { file } of [...found.dataModels, ...found.mappings, ...found.formats]) {
        const key = recentKey(file);
        if (stagedKeys.has(key) || loadedByKey.has(key)) continue;
        const known = out.get(key);
        if (!known || compareConfigVersions(file.version, known.version) > 0) out.set(key, file);
      }
    }
    return [...out.values()].sort((a, b) =>
      KIND_ORDER.indexOf(a.kind ?? 'Format') - KIND_ORDER.indexOf(b.kind ?? 'Format') || nameOf(a).localeCompare(nameOf(b)));
  }, [stagedEntries, stagedKeys, loadedByKey, recentFiles, configurations, cachedPaths]);

  /** Pick a version; it takes the place of another picked version of the same configuration. */
  const stage = useCallback((entry: RecentFile) => {
    setStaged(prev => [
      ...prev.filter(path => {
        const other = recentFiles.find(r => r.path === path);
        return !other || recentKey(other) !== recentKey(entry);
      }),
      entry.path,
    ]);
  }, [recentFiles]);

  const unstage = useCallback((path: string) => setStaged(prev => prev.filter(p => p !== path)), []);

  const stageAll = () => {
    // The newest version of each configuration the filter shows, unless a
    // version of it is picked already.
    const picks = filteredGroups.filter(group => !stagedKeys.has(group.key)).map(group => group.versions[0].path);
    setStaged(prev => [...prev, ...picks]);
  };

  const loadStaged = async () => {
    if (stagedEntries.length === 0 || loading) return;
    setLoading(true);
    try {
      // A picked version replaces the loaded one: close that first, from the
      // last index down so the earlier indices stay valid.
      const replaced = stagedEntries
        .map(entry => loadedByKey.get(recentKey(entry)))
        .filter((index): index is number => index != null)
        .sort((a, b) => b - a);
      for (const index of replaced) removeConfiguration(index);
      await loadMany(stagedEntries);
      setStaged([]);
    } finally {
      setLoading(false);
    }
  };

  const hierarchy = useMemo(() => buildExplorerModelGroups(configurations), [configurations]);

  const openInTab = useCallback((configIndex: number) => {
    navigateToTreeNode(`cfg-${configIndex}`);
    onOpenChange(false);
  }, [navigateToTreeNode, onOpenChange]);

  const renderLoadedRow = (idx: number, depth: number) => {
    const cfg = configurations[idx];
    if (!cfg) return null;
    const name = cfg.solutionVersion.solution.name || cfg.filePath;
    if (!matches(query, name, cfg.filePath)) return null;
    const version = getBestVersion(cfg);
    const recent = recentFiles.find(r => r.path === cfg.filePath);
    return (
      <li key={cfg.filePath} className={`ws-row ws-row--${kindAccent[cfg.content.kind]}`} style={{ ['--ws-depth' as string]: depth }}>
        <KindIcon kind={cfg.content.kind} />
        <span className="ws-row-body">
          <span className="ws-row-name" title={name}>{name}</span>
          <span className="ws-row-meta">
            {version && <span className="ws-version">v{version}</span>}
            <SourcePill source={recent?.source} path={cfg.filePath} />
            <Origin path={cfg.filePath} recent={recent} />
          </span>
        </span>
        <span className="ws-row-actions">
          <Tooltip content={t.explorerOpenInTab} relationship="label">
            <Button appearance="subtle" size="small" icon={<OpenRegular />} onClick={() => openInTab(idx)} />
          </Tooltip>
          <Tooltip content={t.compareWithVersionAction} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<BranchCompareRegular />}
              onClick={() => {
                // One dialog at a time: the picker takes the manager's place.
                onOpenChange(false);
                openVersionComparePicker(idx);
              }}
            />
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

  /** A cached version: the whole row picks it for loading. */
  const renderVersionRow = (file: RecentFile, opts: { name?: string; kind?: RecentFile['kind']; loadedVersion?: string; depth: number }) => (
    <li key={file.path} className="ws-row ws-row--pick" style={{ ['--ws-depth' as string]: opts.depth }}>
      <button type="button" className="ws-row-main" onClick={() => stage(file)} title={t.workspaceAdd}>
        {opts.kind !== undefined && <KindIcon kind={opts.kind} />}
        <span className="ws-row-body">
          {opts.name && <span className="ws-row-name" title={opts.name}>{opts.name}</span>}
          <span className="ws-row-meta">
            {file.version && <span className="ws-version">v{file.version}</span>}
            <SourcePill source={file.source} path={file.path} />
            <Origin path={file.path} recent={file} />
            {opts.loadedVersion && <span className="ws-note">{t.workspaceLoadedVersion(opts.loadedVersion)}</span>}
          </span>
        </span>
      </button>
      <span className="ws-row-actions">
        <Tooltip content={t.workspaceRemoveFromCache} relationship="label">
          <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={() => removeRecentFile(file.path)} />
        </Tooltip>
        <Tooltip content={t.workspaceAdd} relationship="label">
          <Button appearance="subtle" size="small" icon={<ArrowRightRegular />} onClick={() => stage(file)} />
        </Tooltip>
      </span>
    </li>
  );

  const availableRows = KIND_ORDER.flatMap(kind => {
    const ofKind = filteredGroups.filter(group => (group.kind ?? 'Format') === kind);
    if (ofKind.length === 0) return [];
    return [
      <li key={`head-${kind}`} className="ws-subhead">{t.explorerGroupLabels[kind]}</li>,
      ...ofKind.flatMap(group => {
        // One version: a single row. More: the configuration, its versions below.
        if (group.versions.length === 1) {
          return [renderVersionRow(group.versions[0], { name: group.name, kind: group.kind, loadedVersion: group.loadedVersion, depth: 0 })];
        }
        return [
          <li key={group.key} className="ws-row ws-row--group">
            <KindIcon kind={group.kind} />
            <span className="ws-row-body">
              <span className="ws-row-name" title={group.name}>{group.name}</span>
              <span className="ws-row-meta">
                <span>{t.workspaceVersionCount(group.versions.length)}</span>
                {group.loadedVersion && <span className="ws-note">{t.workspaceLoadedVersion(group.loadedVersion)}</span>}
              </span>
            </span>
          </li>,
          ...group.versions.map(file => renderVersionRow(file, { depth: 1 })),
        ];
      }),
    ];
  });

  const stagedRows = stagedEntries.map(entry => {
    const loadedIndex = loadedByKey.get(recentKey(entry));
    const replaces = loadedIndex != null ? getBestVersion(configurations[loadedIndex]) : undefined;
    const name = nameOf(entry);
    return (
      <li key={entry.path} className={`ws-row ws-row--staged ws-row--${kindAccent[entry.kind ?? ''] ?? 'unknown'}`}>
        <KindIcon kind={entry.kind} />
        <span className="ws-row-body">
          <span className="ws-row-name" title={name}>{name}</span>
          <span className="ws-row-meta">
            {entry.version && <span className="ws-version">v{entry.version}</span>}
            <SourcePill source={entry.source} path={entry.path} />
            {replaces && <span className="ws-note ws-note--warn">{t.workspaceReplacesVersion(replaces)}</span>}
          </span>
        </span>
        <span className="ws-row-actions">
          <Tooltip content={t.workspaceUnstage} relationship="label">
            <Button appearance="subtle" size="small" icon={<ArrowLeftRegular />} onClick={() => unstage(entry.path)} />
          </Tooltip>
        </span>
      </li>
    );
  });

  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      {/* Fluent injects its Griffel styles after our stylesheet, so plain
          class rules lose against the surface defaults — set the geometry
          inline. `resize` needs a non-visible overflow to draw the grip. */}
      <DialogSurface
        ref={surfaceRef}
        className="ws-surface"
        style={{
          width: 'min(1100px, calc(100vw - 48px))',
          maxWidth: 'calc(100vw - 32px)',
          // Hugs its columns instead of always standing 820px tall.
          height: 'auto',
          maxHeight: 'calc(100vh - 64px)',
          minWidth: `${WS_DIALOG_MIN_W}px`,
          minHeight: `${WS_DIALOG_MIN_H}px`,
          // A size the user dragged wins over the content-driven default.
          ...(dialogSize ? { width: dialogSize.width, height: dialogSize.height } : {}),
          overflow: 'hidden',
          // A column, so the body can shrink to the max-height: a percentage
          // max-height on the body resolves to nothing under an auto height,
          // and the columns ran out of the dialog instead of scrolling.
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <DialogBody className="ws-dialog-body" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
          <DialogTitle
            className="ws-titlebar"
            action={
              <Button
                className="ws-dialog-close"
                appearance="subtle"
                size="small"
                icon={<DismissRegular />}
                aria-label={t.dismiss}
                onClick={() => onOpenChange(false)}
              />
            }
          >
            <span className="ws-title">{t.workspaceManager}</span>
          </DialogTitle>
          <DialogContent className="ws-content" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="ws-toolbar">
              <Input
                size="medium"
                className="ws-filter"
                value={query}
                onChange={(_, d) => setQuery(d.value)}
                placeholder={t.workspaceFilterPlaceholder}
                contentBefore={<SearchRegular fontSize={16} />}
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
                    if (result === null) {
                      fileInputRef.current?.click();
                      return;
                    }
                    for (const err of result.errors) pushToast({ kind: 'error', message: err });
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

            <div className="ws-columns">
              <section className="ws-column" aria-label={t.workspaceAvailable}>
                <div className="ws-section-head">
                  <span>{t.workspaceAvailable}</span>
                  <span className="ws-section-spacer" />
                  {filteredGroups.some(group => !stagedKeys.has(group.key)) && (
                    <Button appearance="subtle" size="small" icon={<ArrowRightRegular />} iconPosition="after" onClick={stageAll}>
                      {t.workspaceStageAll}
                    </Button>
                  )}
                </div>
                <div className="ws-column-body">
                  {groups.length === 0 ? (
                    <p className="ws-empty">{t.workspaceAvailableEmpty}</p>
                  ) : filteredGroups.length === 0 ? (
                    <p className="ws-empty">{t.workspaceNoMatch}</p>
                  ) : (
                    <ul className="ws-list">{availableRows}</ul>
                  )}
                </div>
                <p className="ws-hint">{t.workspaceClosedHint}</p>
              </section>

              <section className="ws-column" aria-label={t.workspaceLoaded}>
                <div className="ws-column-body">
                  <div className="ws-section-head">
                    <span>{t.workspaceStaged}</span>
                  </div>
                  {stagedRows.length === 0 ? (
                    <p className="ws-empty">{t.workspaceStagedEmpty}</p>
                  ) : (
                    <>
                      <ul className="ws-list">{stagedRows}</ul>
                      {related.length > 0 && (
                        <div className="ws-related">
                          <div className="ws-related-head" title={t.workspaceRelatedHint}>{t.workspaceRelated}</div>
                          <ul className="ws-list">
                            {related.map(file => {
                              const name = nameOf(file);
                              return (
                                <li key={file.path} className="ws-row ws-row--pick">
                                  <button type="button" className="ws-row-main" onClick={() => stage(file)} title={t.workspaceAdd}>
                                    <KindIcon kind={file.kind} />
                                    <span className="ws-row-body">
                                      <span className="ws-row-name" title={name}>{name}</span>
                                      <span className="ws-row-meta">
                                        {file.version && <span className="ws-version">v{file.version}</span>}
                                        <SourcePill source={file.source} path={file.path} />
                                      </span>
                                    </span>
                                  </button>
                                  <span className="ws-row-actions">
                                    <Tooltip content={t.workspaceAdd} relationship="label">
                                      <Button appearance="subtle" size="small" icon={<AddRegular />} onClick={() => stage(file)} />
                                    </Tooltip>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </>
                  )}

                  <div className="ws-section-head ws-section-head--spaced">
                    <span>{t.workspaceLoaded}</span>
                    <span className="ws-section-spacer" />
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<DismissSquareMultipleRegular />}
                      disabled={configurations.length === 0}
                      onClick={closeAllConfigurationsWithUndo}
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
                </div>
                {/* Below the scrolling list, so a long load list or workspace
                    never pushes the button out of sight. */}
                {stagedRows.length > 0 && (
                  <div className="ws-load-bar">
                    <Button appearance="primary" size="small" disabled={loading} onClick={() => { void loadStaged(); }}>
                      {loading ? t.workspaceLoadingStaged : t.workspaceLoadStaged(stagedEntries.length)}
                    </Button>
                    <Button appearance="subtle" size="small" disabled={loading} onClick={() => setStaged([])}>
                      {t.workspaceClearStaged}
                    </Button>
                  </div>
                )}
              </section>
            </div>

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
        </DialogBody>
        <span
          className="dialog-resize-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.resizeDialog}
          title={t.resizeDialog}
          onPointerDown={startResize}
          onDoubleClick={() => resetSize()}
        />
      </DialogSurface>
    </Dialog>
  );
}
