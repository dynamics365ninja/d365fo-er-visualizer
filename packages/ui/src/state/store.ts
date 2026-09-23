import { create } from 'zustand';
import type { ERConfiguration, ERLabel } from '@er-visualizer/core';
import { parseERConfigurations, GUIDRegistry } from '@er-visualizer/core';
import { locale, t } from '../i18n';
import { useFnoSession } from './fno-session';
import { clearHarvestedLabels } from '../utils/label-resolver';
import { onFnoDownloadEvent } from '../fno/session';
import { FnoEmptyContentError } from '@er-visualizer/fno-client';
import {
  saveFileContent,
  readFileContent,
  deleteFileContent,
  clearAllFileContent,
  listCachedPaths,
} from '../utils/content-cache';
import {
  nextThemeMode,
  persistThemeMode,
  readThemeMode,
  resolveThemeMode,
  systemTheme,
  type ResolvedTheme,
  type ThemeMode,
} from '../theme';
import {
  MAX_RECENT_FILES,
  RECENT_FILES_STORAGE_KEY,
  RECENT_SESSIONS_STORAGE_KEY,
  bundleContentPath,
  deriveRecentSessionsAfterConfigChange,
  describeRecentFile,
  loadJSON,
  persistTechnicalDetails,
  readStoredTechnicalDetails,
  sanitizeRecentFiles,
  sanitizeRecentSessions,
  saveRecentFiles,
  saveRecentSessions,
  type RecentFile,
  type RecentSession,
} from './persistence';
import { buildTreeForConfig, findNodeById, type TreeNode } from './tree-builder';
import { collectConfigurationWarnings, type ConfigWarning } from './config-warnings';
import { mergeConfiguration, normalizeSolutionId } from './configuration-merge';
import {
  openDesignerTabsForFormats,
  pruneNavigationStack,
  pushNavigationHistory,
  remapIdAfterConfigRemoval,
  remapNavigationStackAfterRemoval,
  stepNavigation,
  type NavigationSnapshot,
  type OpenTab,
} from './navigation';
import {
  findBindingNode,
  findDatasourceNode,
  findModelPathBindings,
  resolveBinding,
  resolveDatasource,
  resolveModelPath,
  type ModelPathBinding,
  type ResolvedBinding,
  type ResolvedDatasource,
  type ResolvedModelPath,
} from './expression-resolution';
import { findWhereUsed, type WhereUsedEntry } from './where-used';

// The store's helpers live in the modules imported above; everything that used
// to be exported from here still is, so importers keep using './store'.
export type { RecentFile, RecentSession, RelatedRecentFiles } from './persistence';
export {
  bundleContentPath,
  configurationModelId,
  deriveRecentSessionsAfterConfigChange,
  describeRecentFile,
  findRelatedRecentFiles,
  sanitizeRecentFiles,
  sanitizeRecentSessions,
} from './persistence';
export type { TreeNode } from './tree-builder';
export type { ConfigWarning } from './config-warnings';
export { expressionRootToken } from './config-warnings';
export { compareConfigVersions } from './configuration-merge';
export type { OpenTab } from './navigation';
export { openDesignerTabsForFormats, remapIdAfterConfigRemoval } from './navigation';
export {
  activeMappingDefinitionLabel,
  getMappingDefinitions,
  getScopedMappingDefinitions,
  relatedMappingDefinitionLabels,
  selectMappingDefinition,
} from './mapping-definitions';
export { mappingDefinitionLabel } from '@er-visualizer/core';
export type { DeepDatasourceInfo, DeepResolutionResult } from './expression-resolution';
export { parseDottedPath, resolveDeepExpression } from './expression-resolution';
export type { WhereUsedEntry } from './where-used';

export type { ThemeMode, ResolvedTheme } from '../theme';
/** The two panes of the designer's side-by-side view: `main` on the left, `side` on the right. */
export type DesignerPane = 'main' | 'side';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
  /** Optional action to show inside the toast (e.g. "Retry"). */
  action?: { label: string; onClick: () => void };
  /** How long a non-error toast stays up; defaults to 6 s. */
  durationMs?: number;
}

export type FnoIngestItemStatus = 'queued' | 'downloading' | 'done' | 'empty' | 'failed' | 'skipped';

/** One row of the structured F&O download log shown in the ingest dialog. */
export interface FnoIngestItem {
  key: string;
  name: string;
  kind: 'DataModel' | 'ModelMapping' | 'Format' | 'Unknown';
  status: FnoIngestItemStatus;
  /** True when the user ticked this item (vs. auto-resolved dependency). */
  explicit: boolean;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface FnoIngestProgress {
  active: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  items: FnoIngestItem[];
}

/** Shortest free-text query `executeSearch` runs; shorter ones yield no results. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

// ─── App State ───

export interface AppState {
  configurations: ERConfiguration[];
  registry: GUIDRegistry;
  treeNodes: TreeNode[];
  selectedNodeId: string | null;
  selectedNode: TreeNode | null;
  /**
   * A selection the explorer should not follow. The format designer selects
   * rows as the user walks its structure; expanding the explorer along with
   * every step is noise, so that selection is muted until something else —
   * "Reveal in Explorer", search, the explorer itself — selects a node.
   */
  explorerMutedSelectionId: string | null;
  openTabs: OpenTab[];
  activeTabId: string | null;
  /**
   * File path of the format whose tab was active last. Switching to a model
   * mapping (or data model) tab keeps it, so the mapping still opens on the
   * definition that format binds to rather than on whichever loaded first.
   */
  lastActiveFormatPath: string | null;
  /**
   * The designer splits into two groups of tabs, as an IDE does: the main
   * group on the left, the side group on the right, each with its own tab
   * strip. `activeTabId` is the tab shown in the main group, `splitTabId` the
   * one shown in the side group (`null` while there is none).
   */
  splitTabId: string | null;
  /** Tabs of the side group, in no particular order (the strip follows `openTabs`). Empty when not split. */
  sideTabIds: string[];
  /**
   * The pane that has focus while split: tabs picked in the tab strip or opened
   * from the explorer, search or a drill-down land in it, as in VS Code.
   * Always `'main'` when not split.
   */
  focusedPane: DesignerPane;
  /**
   * Stops the running F&O download, while one runs. The download overlay
   * covers the F&O browser that started it, so the overlay offers it too.
   */
  cancelFnoIngest: (() => void) | null;
  /** Tab being dragged from a tab strip; the groups show drop zones meanwhile. */
  draggingTabId: string | null;
  searchQuery: string;
  searchResults: any[];
  searchPanelMode: 'search' | 'where-used';
  whereUsedQuery: string;
  whereUsedResults: WhereUsedEntry[];
  whereUsedScope: 'all' | 'mapping' | 'format';
  activeWhereUsedRefKey: string | null;
  showTechnicalDetails: boolean;
  /** The user's preference. Read `resolvedTheme` to know what is on screen. */
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  navigationHistory: NavigationSnapshot[];
  navigationForward: NavigationSnapshot[];
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  toasts: Toast[];
  explorerExpandCommand: { mode: 'default' | 'all' | 'none'; version: number };
  recentFiles: RecentFile[];
  recentSessions: RecentSession[];
  /** Set of file paths whose XML content is currently cached in IndexedDB. */
  cachedPaths: Set<string>;
  warnings: ConfigWarning[];
  /**
   * One-shot "run where-used for this" request. `consumed` is set once the
   * search panel has run it, so a later remount of the panel does not replay
   * a stale query.
   */
  whereUsedTrigger: { query: string; version: number; consumed: boolean } | null;

  /** Global F&O download progress label, empty when idle. */
  fnoIngestStatus: string;
  /** Structured per-configuration progress of the running / last F&O download. */
  fnoIngestProgress: FnoIngestProgress;
  /** One-shot request to show the landing page on a given source tab. */
  landingRequest: { tab: 'local' | 'remote'; version: number } | null;
  requestLanding: (tab: 'local' | 'remote') => void;

  // Actions
  /**
   * Parse and merge an ER export. Returns `false` when nothing was loaded
   * because a newer version of the same configuration is already open.
   */
  loadXmlFile: (xml: string, filePath: string, options?: { source?: 'file' | 'fno' }) => boolean;
  removeConfiguration: (index: number) => void;
  /** Close a configuration and offer an undo toast that re-opens it from the cache. */
  closeConfigurationWithUndo: (index: number) => void;
  removeAllConfigurations: () => void;
  /** Close every configuration, with an "Undo" toast that reopens the cached ones. */
  closeAllConfigurationsWithUndo: () => void;
  beginFnoIngest: (items: Array<Pick<FnoIngestItem, 'key' | 'name' | 'kind' | 'explicit'>>) => void;
  updateFnoIngestItem: (item: Pick<FnoIngestItem, 'key' | 'name' | 'kind'> & Partial<FnoIngestItem>) => void;
  endFnoIngest: () => void;
  selectNode: (nodeId: string | null, options?: { revealInExplorer?: boolean }) => void;
  openTab: (id: string, label: string, configIndex: number) => void;
  /** `side` opens the drill-down next to the active tab instead of in its place. */
  openDrillDownTab: (expression: string, configIndex: number, elementName?: string, options?: { side?: boolean }) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /** Show tab `id` to the right of the active tab. */
  openTabToSide: (id: string) => void;
  /** Move tab `id` into the given group (creating the side group for `'side'`); the group takes focus. */
  moveTabToPane: (id: string, pane: DesignerPane) => void;
  /** Move tab `id` in the tab strip to just before `beforeId` (or to the end when `null`). */
  reorderTab: (id: string, beforeId: string | null) => void;
  focusPane: (pane: DesignerPane) => void;
  /** Close one group of the split view; its tabs join the other one, which takes the whole width. */
  closePane: (pane: DesignerPane) => void;
  setDraggingTab: (id: string | null) => void;
  closeSplit: () => void;
  rebuildDerivedState: () => void;
  setShowTechnicalDetails: (show: boolean) => void;
  setFnoIngestStatus: (status: string) => void;
  /** Re-issue the configurations array so label-dependent views re-resolve against the (grown) harvested pool. */
  refreshLabelPool: () => void;
  /**
   * Merge label texts inherited from an ancestor data model (which is NOT
   * loaded into the workspace) into the configurations whose inheritance
   * chain passes through it — `targetSolutionIds` are the direct inheritors,
   * their loaded descendants are included automatically.
   */
  addInheritedLabels: (targets: { solutionIds?: readonly string[]; filePaths?: readonly string[] }, labels: readonly ERLabel[]) => void;
  setThemeMode: (mode: ThemeMode) => void;
  /** Advance the switch: system → light → dark → system. */
  cycleTheme: () => void;
  /** Called by the `prefers-color-scheme` listener while the mode is `system`. */
  syncSystemTheme: () => void;
  setSearchQuery: (query: string) => void;
  executeSearch: () => void;
  setSearchPanelMode: (mode: 'search' | 'where-used') => void;
  setWhereUsedQuery: (query: string) => void;
  executeWhereUsed: (query?: string) => void;
  clearWhereUsed: () => void;
  setWhereUsedScope: (scope: 'all' | 'mapping' | 'format') => void;
  setActiveWhereUsedRefKey: (key: string | null) => void;
  navigateToTreeNode: (nodeId: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;

  // Toasts
  pushToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => string;
  dismissToast: (id: string) => void;

  // Tree expansion (global, persisted)
  /** Broadcast an expand/collapse command to the explorer tree (non-persistent UX signal). */
  requestExplorerExpand: (mode: 'all' | 'none' | 'default') => void;

  // Recent files
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;
  /** Re-load a recent file from its cached XML content. Returns true on success. */
  reloadRecentFile: (path: string) => Promise<boolean>;
  /** Add a single cached file to the workspace without touching what's loaded. */
  loadCachedFile: (path: string, name?: string) => Promise<boolean>;

  // Recent sessions
  removeRecentSession: (id: string) => void;
  clearRecentSessions: () => void;
  /**
   * Load all files of a saved session. Files are merged into the current
   * workspace unless `replace` is set, which clears it first.
   */
  loadRecentSession: (id: string, options?: { replace?: boolean }) => Promise<boolean>;
  /**
   * Resolve a datasource name from an expression string (e.g. "CompanyInfo" from binding expr).
   * Returns { configIndex, datasourceName, treeNodeId } or null.
   */
  resolveDatasource: (expressionOrName: string, fromConfigIndex: number, scopeConfigIndex?: number | null) => ResolvedDatasource | null;
  /**
   * Find a binding tree node for a given model path in a mapping config.
   */
  resolveBinding: (modelPath: string, fromConfigIndex: number) => ResolvedBinding | null;
  /**
   * Find the tree node matching a datasource by name within a given config
   */
  findDatasourceNode: (dsName: string, configIndex: number, parentPath?: string) => string | null;
  /**
   * Find the tree node matching a binding by model path within a given config
   */
  findBindingNode: (modelPath: string, configIndex: number) => string | null;
  /**
   * Resolve a model path (e.g. "model.CompanyInformation.Name") through model mapping
   * to find the actual datasource (table, enum, class).
   * Returns the mapping binding, resolved datasource, and full chain.
   */
  resolveModelPath: (modelDotPath: string, fromConfigIndex?: number | null) => ResolvedModelPath | null;
  /**
   * Bindings that live *under* a model path. A container such as
   * `model.InvoiceLines` often carries no binding of its own — what fills it is
   * only visible through the bindings of the fields inside it.
   */
  findModelPathBindings: (modelDotPath: string, fromConfigIndex?: number | null) => ModelPathBinding[];
  /**
   * Where-used: find all occurrences of a table / enum / class name across all loaded configs.
   * Returns a flat list of trace links from the entity → datasource → model binding → format element.
   */
  whereUsed: (entityName: string) => WhereUsedEntry[];
  triggerWhereUsed: (query: string) => void;
  /** Mark where-used trigger `version` as handled (no-op for any other version). */
  consumeWhereUsedTrigger: (version: number) => void;
}

function buildDerivedState(configurations: ERConfiguration[]): { registry: GUIDRegistry; treeNodes: TreeNode[]; warnings: ConfigWarning[] } {
  const registry = new GUIDRegistry();
  for (const config of configurations) {
    registry.indexConfiguration(config);
  }

  const treeNodes = configurations.map((config, index) => buildTreeForConfig(config, index, configurations));
  const warnings = collectConfigurationWarnings(configurations);
  return { registry, treeNodes, warnings };
}

const initialThemeMode = readThemeMode();

export const useAppStore = create<AppState>((set, get) => ({
  configurations: [],
  registry: new GUIDRegistry(),
  treeNodes: [],
  selectedNodeId: null,
  selectedNode: null,
  explorerMutedSelectionId: null,
  openTabs: [],
  activeTabId: null,
  lastActiveFormatPath: null,
  splitTabId: null,
  sideTabIds: [],
  cancelFnoIngest: null,
  focusedPane: 'main',
  draggingTabId: null,
  searchQuery: '',
  searchResults: [],
  searchPanelMode: 'search',
  whereUsedQuery: '',
  whereUsedResults: [],
  whereUsedScope: 'all',
  activeWhereUsedRefKey: null,
  showTechnicalDetails: readStoredTechnicalDetails(),
  fnoIngestStatus: '',
  fnoIngestProgress: { active: false, startedAt: null, finishedAt: null, items: [] },
  landingRequest: null,
  requestLanding: (tab) => set(state => ({ landingRequest: { tab, version: (state.landingRequest?.version ?? 0) + 1 } })),
  themeMode: initialThemeMode,
  resolvedTheme: resolveThemeMode(initialThemeMode),
  navigationHistory: [],
  navigationForward: [],
  canNavigateBack: false,
  canNavigateForward: false,
  toasts: [],
  explorerExpandCommand: { mode: 'default', version: 0 },
  recentFiles: loadJSON(RECENT_FILES_STORAGE_KEY, [], sanitizeRecentFiles),
  recentSessions: loadJSON(RECENT_SESSIONS_STORAGE_KEY, [], sanitizeRecentSessions),
  cachedPaths: new Set<string>(),
  warnings: [],
  whereUsedTrigger: null,

  loadXmlFile: (xml: string, filePath: string, options?: { source?: 'file' | 'fno' }) => {
    try {
      // A single export can bundle a data model together with its model
      // mapping; the parser hands both back so the model no longer
      // disappears when the mapping/format is re-opened.
      const parsed = parseERConfigurations(xml, filePath);
      const config = parsed.find(c => c.filePath === filePath) ?? parsed[parsed.length - 1];
      const state = get();

      let newConfigs = state.configurations;
      let primaryAdded = false;
      for (const candidate of parsed) {
        const merged = mergeConfiguration(newConfigs, candidate);
        if (merged) newConfigs = merged;
        if (candidate === config && merged) primaryAdded = true;
      }
      // Every candidate was superseded by an already-loaded newer version.
      if (newConfigs === state.configurations && !primaryAdded) {
        const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
        const loadedVersion = state.configurations.find(c =>
          c.content.kind === config.content.kind
          && normalizeSolutionId(c.solutionVersion.solution.id) === normalizeSolutionId(config.solutionVersion.solution.id),
        )?.solutionVersion.publicVersionNumber;
        const version = config.solutionVersion.publicVersionNumber;
        get().pushToast({
          kind: 'info',
          message: locale === 'cs'
            ? `${fileName} (verze ${version}) nebyl načten – již je otevřena novější verze${loadedVersion ? ` ${loadedVersion}` : ''}.`
            : `${fileName} (version ${version}) was not loaded — a newer version${loadedVersion ? ` ${loadedVersion}` : ''} is already open.`,
        });
        return false;
      }

      const { registry, treeNodes, warnings } = buildDerivedState(newConfigs);

      // Add recent entries — one per parsed configuration so bundled
      // extracts (`…#datamodel:{guid}`) can be re-opened from the workspace
      // manager after they are closed.
      const source = options?.source ?? (filePath.startsWith('fno://') ? 'fno' : 'file');
      const now = Date.now();
      const newEntries: RecentFile[] = parsed.map((cfg, i) => ({
        ...describeRecentFile(cfg, source),
        path: cfg.filePath,
        openedAt: now - i,
        bundlePath: cfg.filePath === filePath ? undefined : filePath,
      }));
      const newPaths = new Set(newEntries.map(e => e.path));
      const candidateRecent: RecentFile[] = [
        ...newEntries,
        ...state.recentFiles.filter(r => !newPaths.has(r.path)),
      ].slice(0, MAX_RECENT_FILES);
      const nextRecent = saveRecentFiles(candidateRecent);

      // Build/upsert a recent session that reflects the full set of currently
      // loaded configurations. Older sessions whose file set is a strict
      // subset of the new session are removed so incremental loads collapse.
      const nextSessions = saveRecentSessions(
        deriveRecentSessionsAfterConfigChange(
          state.configurations,
          newConfigs,
          state.recentSessions,
          nextRecent,
        ),
      );

      // Persist full XML to IndexedDB (best effort). Only a write that landed
      // makes the file reopenable — a quota or private-mode failure must not
      // offer a "Reopen" that then finds nothing.
      void saveFileContent(filePath, xml).then(saved => {
        if (saved === false) return;
        const current = get();
        // The entry may have been removed from the recent list meanwhile.
        if (!current.recentFiles.some(r => r.path === filePath)) return;
        const nextCachedPaths = new Set(current.cachedPaths);
        nextCachedPaths.add(filePath);
        // Extracts are reachable through the outer file's cache entry.
        for (const entry of newEntries) {
          if (entry.bundlePath) nextCachedPaths.add(entry.path);
        }
        set({ cachedPaths: nextCachedPaths });
      });

      // The tree was rebuilt, so a selection held from before points at stale
      // objects (or a node that no longer exists) — re-resolve it by id.
      const selectedNode = state.selectedNodeId ? findNodeById(treeNodes, state.selectedNodeId) : null;
      const selection = {
        ...state,
        selectedNodeId: selectedNode ? state.selectedNodeId : null,
        selectedNode,
      };

      set({
        configurations: newConfigs,
        registry,
        treeNodes,
        warnings,
        recentFiles: nextRecent,
        recentSessions: nextSessions,
        ...openDesignerTabsForFormats(selection, parsed, newConfigs, treeNodes),
      });
      return true;
    } catch (e) {
      console.error('Failed to parse ER configuration:', e);
      // Dump the first 500 chars of the payload + its top-level element
      // name so we can understand what shape the backend returned when
      // the parser rejects it. Helpful for F&O custom-service downloads
      // that may not wrap content in `<ERSolutionVersion>`.
      const preview = typeof xml === 'string' ? xml.slice(0, 500) : String(xml);
      const rootMatch = typeof xml === 'string'
        ? /<\s*([A-Za-z_][\w:-]*)[\s>/]/.exec(xml.replace(/^\uFEFF/, '').replace(/^<\?xml[^?]*\?>\s*/, ''))
        : null;
      console.warn('[store] loadXmlFile parse failure', {
        filePath,
        xmlLength: typeof xml === 'string' ? xml.length : 0,
        rootElement: rootMatch?.[1] ?? '<unknown>',
        preview,
      });
      // Surface as a toast instead of letting a window error propagate.
      const message = e instanceof Error ? e.message : String(e);
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
      get().pushToast({ kind: 'error', message: locale === 'cs' ? `Chyba při načítání ${fileName}: ${message}` : `Failed to load ${fileName}: ${message}` });
      throw markErrorReported(e);
    }
  },

  removeConfiguration: (index: number) => {
    const state = get();
    const newConfigs = state.configurations.filter((_, i) => i !== index);
    const { registry, treeNodes, warnings } = buildDerivedState(newConfigs);
    const nextRecentSessions = saveRecentSessions(
      deriveRecentSessionsAfterConfigChange(
        state.configurations,
        newConfigs,
        state.recentSessions,
        state.recentFiles,
      ),
    );

    const openTabs: OpenTab[] = state.openTabs
      .filter(tab => tab.configIndex !== index)
      .map(tab => ({
        ...tab,
        id: remapIdAfterConfigRemoval(tab.id, index) ?? tab.id,
        configIndex: tab.configIndex > index ? tab.configIndex - 1 : tab.configIndex,
      }));

    const activeTabId = remapIdAfterConfigRemoval(state.activeTabId, index);
    const splitTabId = remapIdAfterConfigRemoval(state.splitTabId, index);
    const sideTabIds = state.sideTabIds
      .map(id => remapIdAfterConfigRemoval(id, index))
      .filter((id): id is string => Boolean(id) && openTabs.some(tab => tab.id === id));
    const selectedNodeId = remapIdAfterConfigRemoval(state.selectedNodeId, index);
    const selectedNode = selectedNodeId ? findNodeById(treeNodes, selectedNodeId) : null;
    const navigationHistory = remapNavigationStackAfterRemoval(state.navigationHistory, index);
    const navigationForward = remapNavigationStackAfterRemoval(state.navigationForward, index);

    const nextActiveTabId = activeTabId && openTabs.some(tab => tab.id === activeTabId)
      ? activeTabId
      : (openTabs[openTabs.length - 1]?.id ?? null);

    set({
      configurations: newConfigs,
      registry,
      treeNodes,
      warnings,
      openTabs,
      activeTabId: nextActiveTabId,
      splitTabId,
      sideTabIds,
      selectedNodeId: selectedNode?.id ?? null,
      selectedNode,
      navigationHistory,
      navigationForward,
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: navigationForward.length > 0,
      recentSessions: nextRecentSessions,
    });
    // Search / where-used results carry config indices that just shifted —
    // recompute them against the new registry instead of showing stale hits.
    const after = get();
    if (after.searchQuery.trim()) after.executeSearch();
    if (after.whereUsedQuery.trim()) after.executeWhereUsed();
  },

  closeAllConfigurationsWithUndo: () => {
    const state = get();
    const closed = state.configurations.map(cfg => ({
      path: cfg.filePath,
      name: cfg.solutionVersion.solution.name || cfg.filePath.split(/[\\/]/).pop() || cfg.filePath,
    }));
    if (closed.length === 0) return;
    const reopenable = closed.filter(({ path }) =>
      state.cachedPaths.has(path) || state.recentFiles.some(r => r.path === path && r.bundlePath));
    get().removeAllConfigurations();
    get().pushToast({
      kind: 'info',
      message: t.workspaceClosedAll(closed.length),
      durationMs: UNDO_WINDOW_MS,
      action: reopenable.length > 0
        ? {
            label: t.workspaceUndoCloseAll,
            onClick: () => {
              void (async () => {
                for (const { path, name } of reopenable) await get().loadCachedFile(path, name);
              })();
            },
          }
        : undefined,
    });
  },

  closeConfigurationWithUndo: (index: number) => {
    const cfg = get().configurations[index];
    if (!cfg) return;
    const path = cfg.filePath;
    const name = cfg.solutionVersion.solution.name || path.split(/[\\/]/).pop() || path;
    get().removeConfiguration(index);
    const cached = get().cachedPaths.has(path) || get().recentFiles.some(r => r.path === path && r.bundlePath);
    get().pushToast({
      kind: 'info',
      message: locale === 'cs' ? `Konfigurace „${name}“ byla zavřena.` : `Configuration "${name}" was closed.`,
      action: cached
        ? { label: locale === 'cs' ? 'Znovu otevřít' : 'Reopen', onClick: () => { void get().loadCachedFile(path, name); } }
        : undefined,
    });
  },

  beginFnoIngest: (items) => {
    set({
      fnoIngestProgress: {
        active: true,
        startedAt: Date.now(),
        finishedAt: null,
        items: items.map(i => ({ ...i, status: 'queued' as const })),
      },
    });
  },

  updateFnoIngestItem: (item) => {
    const progress = get().fnoIngestProgress;
    if (!progress.active) return;
    const idx = progress.items.findIndex(i => i.key === item.key);
    const now = Date.now();
    const nextItems = [...progress.items];
    if (idx === -1) {
      nextItems.push({
        explicit: false,
        status: 'queued',
        ...item,
        startedAt: item.status === 'downloading' ? now : item.startedAt,
        finishedAt: item.status && item.status !== 'downloading' && item.status !== 'queued' ? now : undefined,
      });
    } else {
      const prev = nextItems[idx];
      nextItems[idx] = {
        ...prev,
        ...item,
        startedAt: prev.startedAt ?? (item.status === 'downloading' ? now : undefined),
        finishedAt: item.status && item.status !== 'downloading' && item.status !== 'queued' ? now : prev.finishedAt,
      };
    }
    set({ fnoIngestProgress: { ...progress, items: nextItems } });
  },

  endFnoIngest: () => {
    const progress = get().fnoIngestProgress;
    const now = Date.now();
    // Anything still queued/downloading when the batch ends was never loaded
    // (e.g. the flow aborted early) — say so instead of leaving it "queued".
    const items = progress.items.map(i =>
      i.status === 'queued' || i.status === 'downloading'
        ? { ...i, status: 'skipped' as const, finishedAt: now }
        : i,
    );
    set({ fnoIngestProgress: { ...progress, items, active: false, finishedAt: now } });
  },

  removeAllConfigurations: () => {
    const state = get();
    const { registry, treeNodes, warnings } = buildDerivedState([]);
    const nextRecentSessions = saveRecentSessions(
      deriveRecentSessionsAfterConfigChange(
        state.configurations,
        [],
        state.recentSessions,
        state.recentFiles,
      ),
    );
    set({
      configurations: [],
      registry,
      treeNodes,
      warnings,
      openTabs: [],
      activeTabId: null,
      splitTabId: null,
      sideTabIds: [],
      selectedNodeId: null,
      selectedNode: null,
      navigationHistory: [],
      navigationForward: [],
      canNavigateBack: false,
      canNavigateForward: false,
      searchPanelMode: 'search',
      searchQuery: '',
      searchResults: [],
      whereUsedQuery: '',
      whereUsedResults: [],
      whereUsedScope: 'all',
      activeWhereUsedRefKey: null,
      recentSessions: nextRecentSessions,
    });
    useFnoSession.getState().clearSelection();
    // Labels harvested for this workspace must not leak into the next one,
    // which may come from another F&O environment.
    clearHarvestedLabels();
  },

  selectNode: (nodeId: string | null, options?: { revealInExplorer?: boolean }) => {
    if (!nodeId) {
      set({ selectedNodeId: null, selectedNode: null, explorerMutedSelectionId: null });
      return;
    }
    const state = get();
    const node = findNodeById(state.treeNodes, nodeId);
    set({
      selectedNodeId: nodeId,
      selectedNode: node,
      explorerMutedSelectionId: options?.revealInExplorer === false ? nodeId : null,
    });
  },

  openTab: (id: string, label: string, configIndex: number) => {
    const state = get();
    const navigationHistory = pushNavigationHistory(state, id, state.selectedNodeId);
    if (!state.openTabs.find(t => t.id === id)) {
      set({
        openTabs: [...state.openTabs, { id, label, configIndex }],
        ...showTabInFocusedPane(state, id),
        navigationHistory,
        navigationForward: [],
        canNavigateBack: navigationHistory.length > 0,
        canNavigateForward: false,
      });
    } else {
      set({
        ...showTabInFocusedPane(state, id),
        navigationHistory,
        navigationForward: [],
        canNavigateBack: navigationHistory.length > 0,
        canNavigateForward: false,
      });
    }
  },

  closeTab: (id: string) => {
    const state = get();
    const newTabs = state.openTabs.filter(t => t.id !== id);
    // The group the tab was in shows its neighbour next; a group left
    // without tabs closes (see normalizeGroups).
    const pane = paneOfTab(state, id);
    const groupTabs = tabsInPane(state, pane);
    const newActive = pane === 'main' && state.activeTabId === id ? neighbourTab(groupTabs, id) : state.activeTabId;
    const nextSplit = pane === 'side' && state.splitTabId === id ? neighbourTab(groupTabs, id) : state.splitTabId;
    // A closed tab is not somewhere Back/Forward should return to.
    const navigationHistory = pruneNavigationStack(state.navigationHistory, id);
    const navigationForward = pruneNavigationStack(state.navigationForward, id);
    set({
      openTabs: newTabs,
      activeTabId: newActive,
      splitTabId: nextSplit,
      sideTabIds: state.sideTabIds.filter(tabId => tabId !== id),
      navigationHistory,
      navigationForward,
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: navigationForward.length > 0,
    });
  },

  openDrillDownTab: (expression: string, configIndex: number, elementName?: string, options?: { side?: boolean }) => {
    const trimmed = expression.trim();
    if (!trimmed) return;
    const id = `drilldown:${configIndex}:${elementName ?? ''}:${trimmed}`;
    const state = get();
    // The format goes into the label: the same field drilled down in two
    // formats, side by side, would otherwise be two identical tabs.
    const configName = state.configurations[configIndex]?.solutionVersion.solution.name;
    const label = `${elementName ?? trimmed.split(/[.(]/)[0] ?? trimmed}${configName ? ` · ${configName}` : ''}`.slice(0, 90);
    const openTabs = state.openTabs.some(t => t.id === id)
      ? state.openTabs
      : [...state.openTabs, { kind: 'drillDown' as const, id, label, configIndex, expression: trimmed, elementName }];
    const onScreen = id === state.activeTabId || (isSplitView(state) && id === state.splitTabId);
    if (!options?.side || !state.activeTabId || onScreen) {
      set({ openTabs, ...showTabInFocusedPane(state, id) });
      return;
    }
    // "Beside" is the group that does not have focus — the one the
    // drill-down was not opened from.
    const other: DesignerPane = isSplitView(state) && state.focusedPane === 'side' ? 'main' : 'side';
    set({ openTabs, ...placeTabInPane({ ...state, openTabs }, id, other) });
  },

  openTabToSide: (id: string) => get().moveTabToPane(id, 'side'),

  moveTabToPane: (id: string, pane: DesignerPane) => {
    const state = get();
    if (!state.openTabs.some(t => t.id === id)) return;
    set(placeTabInPane(state, id, pane));
  },

  reorderTab: (id: string, beforeId: string | null) => {
    const state = get();
    const tab = state.openTabs.find(t => t.id === id);
    if (!tab || id === beforeId) return;
    const rest = state.openTabs.filter(t => t.id !== id);
    const index = beforeId ? rest.findIndex(t => t.id === beforeId) : -1;
    const openTabs = index < 0 ? [...rest, tab] : [...rest.slice(0, index), tab, ...rest.slice(index)];
    if (openTabs.every((t, i) => t === state.openTabs[i])) return;
    set({ openTabs });
  },

  focusPane: (pane: DesignerPane) => {
    const state = get();
    const next = pane === 'side' && isSplitView(state) ? 'side' : 'main';
    if (state.focusedPane !== next) set({ focusedPane: next });
  },

  closePane: (pane: DesignerPane) => {
    const state = get();
    if (!isSplitView(state)) return;
    // The tabs stay open: they join the other group, whose tab stays on screen.
    set({
      activeTabId: pane === 'side' ? state.activeTabId : state.splitTabId,
      splitTabId: null,
      sideTabIds: [],
      focusedPane: 'main',
    });
  },

  setDraggingTab: (id: string | null) => {
    if (get().draggingTabId !== id) set({ draggingTabId: id });
  },

  closeSplit: () => get().closePane('side'),

  setActiveTab: (id: string) => {
    const state = get();
    const navigationHistory = pushNavigationHistory(state, id, state.selectedNodeId);
    set({
      ...showTabInFocusedPane(state, id),
      navigationHistory,
      navigationForward: [],
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: false,
    });
  },

  rebuildDerivedState: () => {
    const state = get();
    const { registry, treeNodes, warnings } = buildDerivedState(state.configurations);
    const selectedNode = state.selectedNodeId ? findNodeById(treeNodes, state.selectedNodeId) : null;
    const openTabs = state.openTabs.filter(tab => tab.configIndex >= 0 && tab.configIndex < state.configurations.length);
    const activeTabId = openTabs.some(tab => tab.id === state.activeTabId)
      ? state.activeTabId
      : (openTabs[0]?.id ?? null);

    set({
      registry,
      treeNodes,
      warnings,
      selectedNode,
      openTabs,
      activeTabId,
      canNavigateBack: state.navigationHistory.length > 0,
    });
  },

  setShowTechnicalDetails: (show: boolean) => {
    persistTechnicalDetails(show);
    set({ showTechnicalDetails: show });
  },

  setFnoIngestStatus: (status: string) => set({ fnoIngestStatus: status }),

  refreshLabelPool: () => set(state => ({ configurations: [...state.configurations] })),

  addInheritedLabels: ({ solutionIds = [], filePaths = [] }, labels) => {
    if (labels.length === 0 || (solutionIds.length === 0 && filePaths.length === 0)) return;
    const norm = (g: string | undefined) => (g ?? '').replace(/^\{|\}$/g, '').toLowerCase();
    const configs = get().configurations;
    // Direct inheritors (by solution GUID or, for F&O downloads whose
    // synthetic envelope may lack a GUID, by file path) plus every loaded
    // configuration derived from them.
    const targets = new Set(solutionIds.map(norm).filter(Boolean));
    const targetPaths = new Set(filePaths);
    for (const cfg of configs) {
      if (targetPaths.has(cfg.filePath)) {
        const id = norm(cfg.solutionVersion?.solution?.id);
        if (id) targets.add(id);
      }
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const cfg of configs) {
        const id = norm(cfg.solutionVersion?.solution?.id);
        const base = norm(cfg.solutionVersion?.solution?.baseSolutionId);
        if (id && base && targets.has(base) && !targets.has(id)) { targets.add(id); grew = true; }
      }
    }
    let changed = false;
    const next = configs.map(cfg => {
      const solution = cfg.solutionVersion?.solution;
      if (!solution) return cfg;
      if (!targets.has(norm(solution.id)) && !targetPaths.has(cfg.filePath)) return cfg;
      const own = solution.labels ?? [];
      const seen = new Set(own.map(l => `${l.labelId}\u0000${l.languageId}`));
      const added = labels.filter(l => !seen.has(`${l.labelId}\u0000${l.languageId}`));
      if (added.length === 0) return cfg;
      changed = true;
      return {
        ...cfg,
        solutionVersion: { ...cfg.solutionVersion, solution: { ...solution, labels: [...own, ...added] } },
      };
    });
    if (changed) set({ configurations: next });
  },

  setThemeMode: (mode: ThemeMode) => {
    persistThemeMode(mode);
    set({ themeMode: mode, resolvedTheme: resolveThemeMode(mode) });
  },

  cycleTheme: () => {
    get().setThemeMode(nextThemeMode(get().themeMode));
  },

  syncSystemTheme: () => {
    if (get().themeMode !== 'system') return;
    const next = systemTheme();
    if (next !== get().resolvedTheme) set({ resolvedTheme: next });
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),

  executeSearch: () => {
    const state = get();
    // A single character matches nearly every cross-reference, and each hit
    // is resolved and rendered by the panel — not worth it for a query that
    // is almost certainly still being typed.
    if (state.searchQuery.trim().length < MIN_SEARCH_QUERY_LENGTH) {
      set({ searchResults: [] });
      return;
    }
    const results = state.registry.search(state.searchQuery);
    set({ searchResults: results });
  },

  setSearchPanelMode: (mode) => set({ searchPanelMode: mode }),

  setWhereUsedQuery: (query) => set({ whereUsedQuery: query }),

  executeWhereUsed: (query) => {
    const state = get();
    const nextQuery = query ?? state.whereUsedQuery;
    const results = nextQuery.trim() ? state.whereUsed(nextQuery) : [];
    set({
      whereUsedQuery: nextQuery,
      whereUsedResults: results,
      activeWhereUsedRefKey: null,
    });
  },

  clearWhereUsed: () => set({
    whereUsedQuery: '',
    whereUsedResults: [],
    activeWhereUsedRefKey: null,
  }),

  setWhereUsedScope: (scope) => set({ whereUsedScope: scope }),

  setActiveWhereUsedRefKey: (key) => set({ activeWhereUsedRefKey: key }),

  navigateToTreeNode: (nodeId: string) => {
    const state = get();
    const node = findNodeById(state.treeNodes, nodeId);
    if (!node) return;

    // For non-file nodes (format elements, bindings, model fields, etc.) always
    // open the root config file tab so the full designer is shown, not the
    // FocusedNodeTab. The selectedNode drives the in-designer highlight/scroll.
    const rootFileNode = node.type === 'file' || node.configIndex == null
      ? node
      : state.treeNodes[node.configIndex] ?? node;
    const nextTabId = rootFileNode.id;

    const targetTabId = node.configIndex == null ? state.activeTabId : nextTabId;
    const navigationHistory = pushNavigationHistory(state, targetTabId, nodeId);

    set({
      selectedNodeId: nodeId,
      selectedNode: node,
      // Navigating is an explicit request to show the node — the explorer follows.
      explorerMutedSelectionId: null,
      navigationHistory,
      navigationForward: [],
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: false,
    });

    if (node.configIndex == null) return;

    const targetTabLabel = rootFileNode.name;

    const existingTab = state.openTabs.find(t => t.id === nextTabId);
    if (existingTab) {
      set({
        ...showTabInFocusedPane(state, existingTab.id),
        navigationHistory,
        navigationForward: [],
        canNavigateBack: navigationHistory.length > 0,
        canNavigateForward: false,
      });
      return;
    }

    const openTabs = [...state.openTabs, { id: nextTabId, label: targetTabLabel, configIndex: node.configIndex }];
    set({
      openTabs,
      ...showTabInFocusedPane(state, nextTabId),
      navigationHistory,
      navigationForward: [],
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: false,
    });
  },

  navigateBack: () => {
    const patch = stepNavigation(get(), 'back');
    if (patch) set(patch);
  },

  navigateForward: () => {
    const patch = stepNavigation(get(), 'forward');
    if (patch) set(patch);
  },

  // ─── Toasts ───
  pushToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: Toast = { id, createdAt: Date.now(), ...toast };
    set({ toasts: [...get().toasts, entry] });
    // Auto-dismiss non-error kinds (after 6 s unless the toast says otherwise).
    if (toast.kind !== 'error') {
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          const current = get().toasts;
          if (current.some(t => t.id === id)) {
            set({ toasts: current.filter(t => t.id !== id) });
          }
        }, toast.durationMs ?? 6000);
      }
    }
    return id;
  },
  dismissToast: (id: string) => set({ toasts: get().toasts.filter(t => t.id !== id) }),

  // ─── Tree expansion ───
  requestExplorerExpand: (mode) => {
    const current = get().explorerExpandCommand;
    set({ explorerExpandCommand: { mode, version: current.version + 1 } });
  },

  // ─── Recent files ───
  // Removing from history also drops the cached copy, so the file could not
  // be reopened without the disk. Both are undoable: the cache is deleted only
  // once the toast offering "Undo" is gone.
  removeRecentFile: (path: string) => {
    const state = get();
    const index = state.recentFiles.findIndex(r => r.path === path);
    const entry = state.recentFiles[index];
    const wasCached = state.cachedPaths.has(path);
    const next = saveRecentFiles(state.recentFiles.filter(r => r.path !== path));
    const nextCachedPaths = new Set(state.cachedPaths);
    nextCachedPaths.delete(path);
    set({ recentFiles: next, cachedPaths: nextCachedPaths });
    if (!entry) {
      void deleteFileContent(path);
      return;
    }
    const pending = scheduleUndoable(() => { void deleteFileContent(path); });
    get().pushToast({
      kind: 'info',
      message: t.historyFileRemoved(entry.solutionName ?? entry.name),
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: t.undo,
        onClick: () => {
          if (!pending.cancel()) return;
          const current = get().recentFiles.filter(r => r.path !== path);
          const restored = [...current.slice(0, index), entry, ...current.slice(index)];
          const cachedPaths = new Set(get().cachedPaths);
          if (wasCached) cachedPaths.add(path);
          set({ recentFiles: saveRecentFiles(restored), cachedPaths });
        },
      },
    });
  },
  clearRecentFiles: () => {
    const state = get();
    const previousFiles = state.recentFiles;
    const previousCached = state.cachedPaths;
    if (previousFiles.length === 0) return;
    saveRecentFiles([]);
    set({ recentFiles: [], cachedPaths: new Set<string>() });
    const pending = scheduleUndoable(() => { void clearAllFileContent(); });
    get().pushToast({
      kind: 'info',
      message: t.historyFilesCleared(previousFiles.length),
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: t.undo,
        onClick: () => {
          if (!pending.cancel()) return;
          set({ recentFiles: saveRecentFiles(previousFiles), cachedPaths: new Set(previousCached) });
        },
      },
    });
  },
  reloadRecentFile: async (path: string) => {
    const entry = get().recentFiles.find(r => r.path === path);
    if (!entry) return false;
    // Same cache lookup as loadCachedFile: bundled extracts live under the
    // bundle's path, so the entry's own path is never in the cache.
    return get().loadCachedFile(path, entry.solutionName ?? entry.name);
  },

  // ─── Recent sessions ───
  removeRecentSession: (id: string) => {
    const next = saveRecentSessions(get().recentSessions.filter(s => s.id !== id));
    set({ recentSessions: next });
  },
  clearRecentSessions: () => {
    const previous = get().recentSessions;
    if (previous.length === 0) return;
    saveRecentSessions([]);
    set({ recentSessions: [] });
    get().pushToast({
      kind: 'info',
      message: t.historySessionsCleared(previous.length),
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: t.undo,
        onClick: () => set({ recentSessions: saveRecentSessions(previous) }),
      },
    });
  },
  loadRecentSession: async (id: string, options?: { replace?: boolean }) => {
    const session = get().recentSessions.find(s => s.id === id);
    if (!session) return false;

    // Fetch all content from IDB up-front so we can reset state only after
    // we know at least one file is actually available. A bundle and its
    // extracts share one cache entry, so each is read and loaded once.
    const contentPaths = [...new Set(session.files.map(f => bundleContentPath(f.path)))];
    // A cache that cannot be read counts as missing, not as a silent failure.
    const contents = await Promise.all(
      contentPaths.map(async path => {
        try {
          return { path, content: await readFileContent(path) };
        } catch {
          return { path, content: null };
        }
      }),
    );
    const missing = contents.filter(c => !c.content).map(c => c.path.split(/[\\/]/).pop() ?? c.path);
    const available = contents.filter(c => c.content);
    if (available.length === 0) {
      get().pushToast({
        kind: 'warning',
        message: locale === 'cs'
          ? 'Obsah relace už není v mezipaměti, otevřete soubory znovu ručně.'
          : 'The session content is no longer cached, please open the files again.',
      });
      return false;
    }

    // Sessions are merged into the workspace by default so re-opening a
    // mapping or format never closes an already-loaded data model. Only an
    // explicit "replace" clears the workspace first.
    if (options?.replace) {
      clearHarvestedLabels();
      set({
        configurations: [],
        registry: new GUIDRegistry(),
        treeNodes: [],
        warnings: [],
        openTabs: [],
        activeTabId: null,
        splitTabId: null,
        sideTabIds: [],
        selectedNodeId: null,
        selectedNode: null,
        navigationHistory: [],
        navigationForward: [],
        canNavigateBack: false,
        canNavigateForward: false,
        searchPanelMode: 'search',
        searchQuery: '',
        searchResults: [],
        whereUsedQuery: '',
        whereUsedResults: [],
        whereUsedScope: 'all',
        activeWhereUsedRefKey: null,
      });
    }
    let loaded = 0;
    for (const { path, content } of available) {
      if (!content) continue;
      try {
        if (get().loadXmlFile(content, path)) loaded++;
      } catch {
        // loadXmlFile already surfaces a toast on parse failure.
      }
    }
    if (missing.length > 0) {
      get().pushToast({
        kind: 'warning',
        message: locale === 'cs'
          ? `Některé soubory v relaci nebyly načteny (chybí mezipaměť): ${missing.join(', ')}.`
          : `Some files in the session were not loaded (not cached): ${missing.join(', ')}.`,
      });
    }
    // Files that were open already (or newer versions of them) still make
    // the session usable — the designer should open on them.
    const open = new Set(get().configurations.map(cfg => cfg.filePath));
    return loaded > 0 || available.some(({ path }) => open.has(path));
  },

  loadCachedFile: async (path: string, name?: string) => {
    const entry = get().recentFiles.find(r => r.path === path);
    const label = name ?? entry?.solutionName ?? path.split(/[\\/]/).pop() ?? path;
    if (get().configurations.some(c => c.filePath === path)) {
      get().pushToast({
        kind: 'info',
        message: locale === 'cs' ? `„${label}“ už je otevřen v pracovní ploše.` : `"${label}" is already open in the workspace.`,
      });
      return true;
    }
    const contentPath = entry?.bundlePath ?? bundleContentPath(path);
    const content = await readFileContent(contentPath);
    if (!content) {
      get().pushToast({
        kind: 'warning',
        message: locale === 'cs'
          ? `Obsah „${label}“ už není v mezipaměti, otevřete soubor znovu ručně.`
          : `"${label}" is no longer cached, please open the file again.`,
      });
      return false;
    }
    try {
      return get().loadXmlFile(content, contentPath, { source: entry?.source });
    } catch {
      return false;
    }
  },

  resolveDatasource: (expressionOrName: string, fromConfigIndex: number, scopeConfigIndex?: number | null) =>
    resolveDatasource(get(), expressionOrName, fromConfigIndex, scopeConfigIndex),

  resolveBinding: (modelPath: string, fromConfigIndex: number) =>
    resolveBinding(get(), modelPath, fromConfigIndex),

  findDatasourceNode: (dsName: string, configIndex: number, parentPath?: string) =>
    findDatasourceNode(get(), dsName, configIndex, parentPath),

  findBindingNode: (modelPath: string, configIndex: number) =>
    findBindingNode(get(), modelPath, configIndex),

  resolveModelPath: (modelDotPath: string, fromConfigIndex?: number | null) =>
    resolveModelPath(get(), modelDotPath, fromConfigIndex),

  findModelPathBindings: (modelDotPath: string, fromConfigIndex?: number | null) =>
    findModelPathBindings(get(), modelDotPath, fromConfigIndex),

  whereUsed: (entityName: string): WhereUsedEntry[] => {
    if (!entityName.trim()) return [];
    return findWhereUsed(get(), entityName);
  },

  triggerWhereUsed: (query) => set(state => ({
    whereUsedTrigger: { query, version: (state.whereUsedTrigger?.version ?? 0) + 1, consumed: false },
  })),

  consumeWhereUsedTrigger: (version) => set(state => (
    state.whereUsedTrigger && state.whereUsedTrigger.version === version && !state.whereUsedTrigger.consumed
      ? { whereUsedTrigger: { ...state.whereUsedTrigger, consumed: true } }
      : {}
  )),
}));

type GroupState = Pick<AppState, 'openTabs' | 'activeTabId' | 'splitTabId' | 'sideTabIds' | 'focusedPane'>;

/** Whether the designer is split into two groups of tabs. */
export function isSplitView(state: Pick<AppState, 'activeTabId' | 'splitTabId'>): boolean {
  return Boolean(state.splitTabId && state.splitTabId !== state.activeTabId);
}

/** The tab in the focused group — the one the rest of the workspace (explorer scope, search) follows. */
export function focusedTabId(state: Pick<AppState, 'activeTabId' | 'splitTabId' | 'focusedPane'>): string | null {
  return isSplitView(state) && state.focusedPane === 'side' ? state.splitTabId : state.activeTabId;
}

/** The group tab `id` belongs to. */
export function paneOfTab(state: Pick<AppState, 'sideTabIds'>, id: string): DesignerPane {
  return state.sideTabIds.includes(id) ? 'side' : 'main';
}

/** The tabs of one group, in tab strip order. */
export function tabsInPane(state: Pick<AppState, 'openTabs' | 'sideTabIds'>, pane: DesignerPane): OpenTab[] {
  return state.openTabs.filter(tab => paneOfTab(state, tab.id) === pane);
}

/** What a group shows once tab `id` leaves it: the tab before it, else the one after. */
function neighbourTab(groupTabs: OpenTab[], id: string): string | null {
  const index = groupTabs.findIndex(tab => tab.id === id);
  const rest = groupTabs.filter(tab => tab.id !== id);
  if (rest.length === 0) return null;
  return (groupTabs[index - 1] ?? groupTabs[index + 1] ?? rest[rest.length - 1]).id;
}

/**
 * Show tab `id` — `state` is from before the tab was added, if it is new. A
 * tab that is open already comes forward in its own group, which takes focus;
 * a new one joins the focused group.
 */
function showTabInFocusedPane(state: GroupState, id: string): Partial<GroupState> {
  const isNew = !state.openTabs.some(tab => tab.id === id);
  const pane = isNew ? (isSplitView(state) ? state.focusedPane : 'main') : paneOfTab(state, id);
  if (pane === 'side') {
    return {
      splitTabId: id,
      sideTabIds: isNew ? [...state.sideTabIds, id] : state.sideTabIds,
      focusedPane: 'side',
    };
  }
  return { activeTabId: id, focusedPane: 'main' };
}

/**
 * Move tab `id` into `pane` and focus that group. Moving it to the side opens
 * the side group; the main group never gives up its last tab.
 */
function placeTabInPane(state: GroupState, id: string, pane: DesignerPane): Partial<GroupState> {
  const from = paneOfTab(state, id);
  if (from === pane) {
    return pane === 'side' ? { splitTabId: id, focusedPane: 'side' } : { activeTabId: id, focusedPane: 'main' };
  }
  if (pane === 'side') {
    const mainTabs = tabsInPane(state, 'main');
    if (mainTabs.length <= 1) return {};
    return {
      sideTabIds: [...state.sideTabIds, id],
      splitTabId: id,
      activeTabId: state.activeTabId === id ? neighbourTab(mainTabs, id) : state.activeTabId,
      focusedPane: 'side',
    };
  }
  const sideTabs = tabsInPane(state, 'side');
  return {
    sideTabIds: state.sideTabIds.filter(tabId => tabId !== id),
    splitTabId: state.splitTabId === id ? neighbourTab(sideTabs, id) : state.splitTabId,
    activeTabId: id,
    focusedPane: 'main',
  };
}

/**
 * The invariants of the two groups, restored after any change: the side group
 * holds only open tabs and shows one of them; a group left without tabs
 * closes (an empty main group takes over the side group's tabs); the main
 * group shows one of its own tabs; only a split view has a side to focus.
 * `previousMainTab` is what the main group showed before a tab of the side
 * group was activated in its place — say, by Back or by navigation.
 */
export function normalizeGroups(state: GroupState, previousMainTab: string | null = null): GroupState {
  const open = new Set(state.openTabs.map(tab => tab.id));
  let sideTabIds = state.sideTabIds.filter(id => open.has(id));
  let { activeTabId, splitTabId, focusedPane } = state;

  if (activeTabId && sideTabIds.includes(activeTabId)) {
    splitTabId = activeTabId;
    focusedPane = 'side';
    activeTabId = previousMainTab;
  }

  const mainTabs = state.openTabs.filter(tab => !sideTabIds.includes(tab.id));
  if (mainTabs.length === 0 && sideTabIds.length > 0) {
    activeTabId = splitTabId && sideTabIds.includes(splitTabId) ? splitTabId : sideTabIds[sideTabIds.length - 1];
    sideTabIds = [];
  } else if (!activeTabId || !mainTabs.some(tab => tab.id === activeTabId)) {
    activeTabId = mainTabs[mainTabs.length - 1]?.id ?? null;
  }

  if (sideTabIds.length === 0) splitTabId = null;
  else if (!splitTabId || !sideTabIds.includes(splitTabId)) splitTabId = sideTabIds[sideTabIds.length - 1];
  if (!splitTabId) focusedPane = 'main';

  return { openTabs: state.openTabs, activeTabId, splitTabId, sideTabIds, focusedPane };
}

/** How long an "Undo" toast stays up; the undone work runs only after it. */
const UNDO_WINDOW_MS = 10_000;

/**
 * Run `work` once the undo window has passed, unless cancelled first.
 * `cancel()` answers whether it got there in time.
 */
function scheduleUndoable(work: () => void): { cancel: () => boolean } {
  let done = false;
  const timer = setTimeout(() => { done = true; work(); }, UNDO_WINDOW_MS + 500);
  return {
    cancel: () => {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      return true;
    },
  };
}

/**
 * Tag an error the store has already shown in a toast, so the caller that
 * catches it does not report the same failure a second time.
 */
function markErrorReported(error: unknown): unknown {
  if (error instanceof Error) (error as Error & { reported?: boolean }).reported = true;
  return error;
}

/** Index of the format whose tab was active last, or `null` when it is no longer loaded. */
export function lastActiveFormatIndex(state: Pick<AppState, 'configurations' | 'lastActiveFormatPath'>): number | null {
  if (!state.lastActiveFormatPath) return null;
  const index = state.configurations.findIndex(
    cfg => cfg.filePath === state.lastActiveFormatPath && cfg.content.kind === 'Format',
  );
  return index >= 0 ? index : null;
}

// Remember the last format tab. Every action that moves the focused tab (tab
// clicks, navigation, Back/Forward, closing a tab) goes through here, so no
// single one of them has to know about it.
useAppStore.subscribe((state, prev) => {
  // Whichever way the tabs changed (closing, removing a configuration, Back
  // activating a tab of the side group), the two groups stay consistent.
  const previousMainTab = prev.activeTabId && !state.sideTabIds.includes(prev.activeTabId) ? prev.activeTabId : null;
  const groups = normalizeGroups(state, previousMainTab);
  if (
    groups.activeTabId !== state.activeTabId
    || groups.splitTabId !== state.splitTabId
    || groups.focusedPane !== state.focusedPane
    || groups.sideTabIds.length !== state.sideTabIds.length
    || groups.sideTabIds.some((id, i) => id !== state.sideTabIds[i])
  ) {
    useAppStore.setState({
      activeTabId: groups.activeTabId,
      splitTabId: groups.splitTabId,
      sideTabIds: groups.sideTabIds,
      focusedPane: groups.focusedPane,
    });
    return;
  }
  const focusedId = focusedTabId(state);
  if (focusedId === focusedTabId(prev) && state.configurations === prev.configurations) return;
  const tab = state.openTabs.find(t => t.id === focusedId);
  const config = tab ? state.configurations[tab.configIndex] : undefined;
  if (config?.content.kind === 'Format' && config.filePath !== state.lastActiveFormatPath) {
    useAppStore.setState({ lastActiveFormatPath: config.filePath });
  }
});

// Mirror F&O download lifecycle events into the structured ingest log so the
// download dialog can show every configuration (explicit or auto-resolved).
onFnoDownloadEvent(event => {
  const state = useAppStore.getState();
  if (!state.fnoIngestProgress.active) return;
  const c = event.component;
  const key = `${c.solutionName}::${c.configurationName}::${c.componentType}::${c.version ?? ''}`;
  const base = { key, name: c.configurationName || c.solutionName, kind: c.componentType };
  if (event.type === 'start') {
    state.updateFnoIngestItem({ ...base, status: 'downloading' });
  } else if (event.type === 'done') {
    state.updateFnoIngestItem({ ...base, status: 'done' });
  } else {
    const isEmpty = event.error instanceof FnoEmptyContentError;
    const message = event.error instanceof Error ? event.error.message : String(event.error);
    state.updateFnoIngestItem({ ...base, status: isEmpty ? 'empty' : 'failed', message: isEmpty ? undefined : message });
  }
});

// Populate the cachedPaths set from IndexedDB on startup so the landing page
// can indicate which recent files/sessions are actually reloadable.
if (typeof window !== 'undefined') {
  void listCachedPaths().then(paths => {
    if (paths.length === 0) return;
    // Merge rather than replace: a file loaded before this resolves has
    // already added its own path, and the startup listing may predate it.
    const merged = new Set(useAppStore.getState().cachedPaths);
    for (const path of paths) merged.add(path);
    useAppStore.setState({ cachedPaths: merged });
  });
}
