import { create } from 'zustand';
import type {
  ERConfiguration,
  ERComponentKind,
  ERDataModelContent,
  ERModelMappingContent,
  ERFormatContent,
} from '@er-visualizer/core';
import { parseERConfiguration, GUIDRegistry } from '@er-visualizer/core';
import { buildFormatBindingPresentation } from '../utils/format-binding-display';
import {
  saveFileContent,
  readFileContent,
  deleteFileContent,
  clearAllFileContent,
  listCachedPaths,
} from '../utils/content-cache';

const TECHNICAL_DETAILS_STORAGE_KEY = 'er-visualizer.showTechnicalDetails';
const THEME_MODE_STORAGE_KEY = 'er-visualizer.themeMode';
const EXPANDED_IDS_STORAGE_KEY = 'er-visualizer.expandedIds';
const RECENT_FILES_STORAGE_KEY = 'er-visualizer.recentFiles.v1';
const RECENT_SESSIONS_STORAGE_KEY = 'er-visualizer.recentSessions.v1';
const MAX_RECENT_FILES = 12;
const MAX_RECENT_SESSIONS = 12;

export type ThemeMode = 'dark' | 'light';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
  /** Optional action to show inside the toast (e.g. "Retry"). */
  action?: { label: string; onClick: () => void };
}

export interface RecentFile {
  path: string;
  name: string;
  kind?: 'DataModel' | 'ModelMapping' | 'Format';
  openedAt: number;
  /**
   * Cached XML content so the entry can be re-loaded on double-click without
   * re-reading from disk. May be stripped for older entries if storage quota
   * is hit. Undefined means the content is no longer cached.
   */
  content?: string;
}

/**
 * A recent analysis session — a set of files that were loaded together. Each
 * time the user loads an additional file, the growing session supersedes any
 * recent session whose path set is a strict subset, so incremental loads
 * collapse into one final session entry.
 */
export interface RecentSession {
  /** Stable id derived from sorted file paths (fingerprint). */
  id: string;
  openedAt: number;
  files: RecentFile[];
}

export interface ConfigWarning {
  configIndex: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Optional tree node id to navigate to when clicked. */
  nodeId?: string;
}

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures (quota, private mode, etc.)
  }
}

/**
 * Persist the recent-files list. Cached XML content lives in IndexedDB, so
 * localStorage only ever sees the metadata subset.
 */
function saveRecentFiles(files: RecentFile[]): RecentFile[] {
  if (typeof window === 'undefined') return files;
  const metadataOnly = files.map(({ content: _c, ...meta }) => meta as RecentFile);
  try {
    window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(metadataOnly));
  } catch {
    // Ignore storage failures — recent list is a convenience feature.
  }
  return metadataOnly;
}

/**
 * Persist the recent-sessions list. Cached XML content lives in IndexedDB,
 * so only metadata is kept in localStorage.
 */
function saveRecentSessions(sessions: RecentSession[]): RecentSession[] {
  if (typeof window === 'undefined') return sessions;
  const metadataOnly = sessions.map(s => ({
    ...s,
    files: s.files.map(({ content: _c, ...meta }) => meta as RecentFile),
  }));
  try {
    window.localStorage.setItem(RECENT_SESSIONS_STORAGE_KEY, JSON.stringify(metadataOnly));
  } catch {
    // Ignore.
  }
  return metadataOnly;
}

function sessionFingerprint(paths: string[]): string {
  return [...paths].sort().join('\u0001');
}

function readStoredTechnicalDetails(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TECHNICAL_DETAILS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistTechnicalDetails(show: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TECHNICAL_DETAILS_STORAGE_KEY, String(show));
  } catch {
    // Ignore storage failures and keep in-memory state only.
  }
}

function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function persistThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures and keep in-memory state only.
  }
}

// ─── Tree Node (unified for all component types) ───

export interface TreeNode {
  id: string;
  name: string;
  icon: string;
  type: 'file' | 'solution' | 'model' | 'container' | 'field' | 'mapping'
    | 'datasource' | 'binding' | 'validation' | 'format' | 'formatElement'
    | 'formatBinding' | 'enum' | 'enumValue' | 'transformation' | 'section';
  children?: TreeNode[];
  data?: any; // reference to the original typed object
  configIndex?: number; // index in configurations array
}

interface NavigationSnapshot {
  activeTabId: string | null;
  selectedNodeId: string | null;
}

function remapTreeNodeIdAfterRemoval(nodeId: string | null, removedIndex: number): string | null {
  if (!nodeId) return null;
  const match = nodeId.match(/^cfg-(\d+)(.*)$/);
  if (!match) return nodeId;

  const currentIndex = parseInt(match[1], 10);
  const suffix = match[2] ?? '';
  if (currentIndex === removedIndex) return null;
  if (currentIndex < removedIndex) return nodeId;
  return `cfg-${currentIndex - 1}${suffix}`;
}

// ─── App State ───

/**
 * A tab is either bound to a tree node (default) or a free-form drill-down session
 * carrying an expression + configIndex to analyse.
 */
export type OpenTab =
  | { kind?: 'node'; id: string; label: string; configIndex: number }
  | {
      kind: 'drillDown';
      id: string;
      label: string;
      configIndex: number;
      expression: string;
      elementName?: string;
    };

export interface AppState {
  configurations: ERConfiguration[];
  registry: GUIDRegistry;
  treeNodes: TreeNode[];
  selectedNodeId: string | null;
  selectedNode: TreeNode | null;
  openTabs: OpenTab[];
  activeTabId: string | null;
  searchQuery: string;
  searchResults: any[];
  showTechnicalDetails: boolean;
  themeMode: ThemeMode;
  navigationHistory: NavigationSnapshot[];
  navigationForward: NavigationSnapshot[];
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  toasts: Toast[];
  expandedIds: Set<string>;
  explorerExpandCommand: { mode: 'default' | 'all' | 'none'; version: number };
  recentFiles: RecentFile[];
  recentSessions: RecentSession[];
  /** Set of file paths whose XML content is currently cached in IndexedDB. */
  cachedPaths: Set<string>;
  warnings: ConfigWarning[];

  // Actions
  loadXmlFile: (xml: string, filePath: string) => void;
  removeConfiguration: (index: number) => void;
  selectNode: (nodeId: string | null) => void;
  openTab: (id: string, label: string, configIndex: number) => void;
  openDrillDownTab: (expression: string, configIndex: number, elementName?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  rebuildDerivedState: () => void;
  setShowTechnicalDetails: (show: boolean) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setSearchQuery: (query: string) => void;
  executeSearch: () => void;
  navigateToTreeNode: (nodeId: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;

  // Toasts
  pushToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;

  // Tree expansion (global, persisted)
  isNodeExpanded: (nodeId: string) => boolean;
  toggleNodeExpanded: (nodeId: string, defaultExpanded?: boolean) => void;
  setNodeExpanded: (nodeId: string, expanded: boolean) => void;
  expandAll: (rootNodeIds?: string[]) => void;
  collapseAll: () => void;
  /** Broadcast an expand/collapse command to the explorer tree (non-persistent UX signal). */
  requestExplorerExpand: (mode: 'all' | 'none' | 'default') => void;

  // Recent files
  addRecentFile: (file: Omit<RecentFile, 'openedAt'>) => void;
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;
  /** Re-load a recent file from its cached XML content. Returns true on success. */
  reloadRecentFile: (path: string) => Promise<boolean>;

  // Recent sessions
  removeRecentSession: (id: string) => void;
  clearRecentSessions: () => void;
  /** Replace the current analysis by re-loading all files of a saved session. */
  loadRecentSession: (id: string) => Promise<boolean>;
  /**
   * Resolve a datasource name from an expression string (e.g. "CompanyInfo" from binding expr).
   * Returns { configIndex, datasourceName, treeNodeId } or null.
   */
  resolveDatasource: (expressionOrName: string, fromConfigIndex: number) => {
    configIndex: number;
    datasourceName: string;
    treeNodeId: string | null;
    datasource: any;
  } | null;
  /**
   * Find a binding tree node for a given model path in a mapping config.
   */
  resolveBinding: (modelPath: string, fromConfigIndex: number) => {
    configIndex: number;
    treeNodeId: string | null;
    binding: any;
  } | null;
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
  resolveModelPath: (modelDotPath: string) => {
    modelPath: string;
    binding: any;
    bindingConfigIndex: number;
    bindingTreeNodeId: string | null;
    datasource: any | null;
    datasourceConfigIndex: number | null;
    datasourceTreeNodeId: string | null;
  } | null;
  /**
   * Where-used: find all occurrences of a table / enum / class name across all loaded configs.
   * Returns a flat list of trace links from the entity → datasource → model binding → format element.
   */
  whereUsed: (entityName: string) => WhereUsedEntry[];
}

// ─── Where-Used types ───

export interface WhereUsedEntry {
  /** The matched entity name (table, enum, class) */
  entityName: string;
  entityType: 'Table' | 'Enum' | 'Class' | 'CalculatedField' | 'GroupBy' | 'Join' | 'Container' | 'Object' | 'UserParameter' | 'TextMatch' | 'Other';
  /** The datasource in a mapping or format that references the entity */
  datasource: {
    name: string;
    parentPath?: string;
    configIndex: number;
    configName: string;
    kind: 'ModelMapping' | 'Format';
  };
  /** Model binding paths that reach the datasource (from a ModelMapping config) */
  modelPaths: Array<{
    path: string;
    expr: string;
    configIndex: number;
    configName: string;
    /** Optional pre-resolved tree node id for direct click-through navigation. */
    treeNodeId?: string;
    /** Optional short label shown in place of the binding kind chip (e.g. "calc", "validation"). */
    kindLabel?: string;
  }>;
  /** Format elements (in Format configs) that use those model paths or the datasource directly */
  formatUsages: Array<{
    elementId: string;
    elementName: string;
    elementType: string;
    /** Full breadcrumb path of ancestor element names ending with the element itself */
    elementPath: string[];
    expression: string;
    configIndex: number;
    configName: string;
  }>;
}

interface EntityMatchResult {
  matched: boolean;
  entityType: WhereUsedEntry['entityType'];
  entityName: string;
  score: 0 | 1 | 2 | 3;
}

interface MappingSource {
  mapping: any;
  configIndex: number;
  configName: string;
}

function getDatasourcePoolsForConfig(config: ERConfiguration): any[][] {
  if (config.content.kind === 'ModelMapping') {
    return [(config.content as ERModelMappingContent).version.mapping.datasources];
  }

  if (config.content.kind === 'Format') {
    const content = config.content as ERFormatContent;
    return [
      ...content.embeddedModelMappingVersions.map(version => version.mapping.datasources),
      content.formatMappingVersion.formatMapping.datasources,
    ].filter(pool => pool.length > 0);
  }

  return [];
}

function getMappingSourcesForConfig(config: ERConfiguration, configIndex: number): MappingSource[] {
  if (config.content.kind === 'ModelMapping') {
    const mapping = (config.content as ERModelMappingContent).version.mapping;
    return [{ mapping, configIndex, configName: config.solutionVersion.solution.name }];
  }

  if (config.content.kind === 'Format') {
    return (config.content as ERFormatContent).embeddedModelMappingVersions.map(version => ({
      mapping: version.mapping,
      configIndex,
      configName: `${config.solutionVersion.solution.name} • ${version.mapping.name}`,
    }));
  }

  return [];
}

function getAllMappingSources(configurations: ERConfiguration[]): MappingSource[] {
  return configurations.flatMap((config, configIndex) => getMappingSourcesForConfig(config, configIndex));
}

function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function buildDerivedState(configurations: ERConfiguration[]): { registry: GUIDRegistry; treeNodes: TreeNode[]; warnings: ConfigWarning[] } {
  const registry = new GUIDRegistry();
  for (const config of configurations) {
    registry.indexConfiguration(config);
  }

  const treeNodes = configurations.map((config, index) => buildTreeForConfig(config, index));
  const warnings = collectConfigurationWarnings(configurations);
  return { registry, treeNodes, warnings };
}

/**
 * Lightweight validator that walks the parsed configurations and reports
 * issues surfaced to the status bar. Intentionally fast: runs only at load.
 */
function collectConfigurationWarnings(configurations: ERConfiguration[]): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];
  const hasModel = configurations.some(c => c.content.kind === 'DataModel');
  const hasMapping = configurations.some(c => c.content.kind === 'ModelMapping');
  const hasFormat = configurations.some(c => c.content.kind === 'Format');

  if (configurations.length > 0 && !hasModel) {
    warnings.push({
      configIndex: -1,
      severity: 'info',
      message: 'Pro plný drill-down načti i Data Model soubor.',
    });
  }
  if (hasFormat && !hasMapping && !configurations.some(c => c.content.kind === 'Format' && (c.content as ERFormatContent).embeddedModelMappingVersions?.length > 0)) {
    warnings.push({
      configIndex: -1,
      severity: 'warning',
      message: 'Formát bez Model Mapping — výrazy nebude možné trasovat na zdrojové tabulky.',
    });
  }

  configurations.forEach((config, ci) => {
    if (config.content.kind === 'Format') {
      const fmtMap = (config.content as ERFormatContent).formatMappingVersion.formatMapping;
      const dsNames = new Set<string>();
      const walkDs = (list: any[]) => {
        for (const d of list) {
          dsNames.add(d.name);
          if (d.children) walkDs(d.children);
        }
      };
      walkDs(fmtMap.datasources);
      // Count bindings whose expression root is unknown datasource.
      let brokenRefs = 0;
      for (const b of fmtMap.bindings) {
        const expr = (b.expressionAsString ?? '').trim();
        if (!expr) continue;
        const root = expr.split(/[.(\[]/)[0].replace(/['"]/g, '').trim();
        if (!root || root.startsWith('"') || /^\d/.test(root) || root === '@' || root.toLowerCase() === 'model') continue;
        if (!dsNames.has(root)) brokenRefs++;
      }
      if (brokenRefs > 5) {
        warnings.push({
          configIndex: ci,
          severity: 'warning',
          message: `Formát "${config.solutionVersion.solution.name}" obsahuje ${brokenRefs} výrazů odkazujících na neznámý datový zdroj.`,
        });
      }
    }
  });

  return warnings;
}

export const useAppStore = create<AppState>((set, get) => ({
  configurations: [],
  registry: new GUIDRegistry(),
  treeNodes: [],
  selectedNodeId: null,
  selectedNode: null,
  openTabs: [],
  activeTabId: null,
  searchQuery: '',
  searchResults: [],
  showTechnicalDetails: readStoredTechnicalDetails(),
  themeMode: readStoredThemeMode(),
  navigationHistory: [],
  navigationForward: [],
  canNavigateBack: false,
  canNavigateForward: false,
  toasts: [],
  expandedIds: new Set<string>(loadJSON<string[]>(EXPANDED_IDS_STORAGE_KEY, [])),
  explorerExpandCommand: { mode: 'default', version: 0 },
  recentFiles: loadJSON<RecentFile[]>(RECENT_FILES_STORAGE_KEY, []),
  recentSessions: loadJSON<RecentSession[]>(RECENT_SESSIONS_STORAGE_KEY, []),
  cachedPaths: new Set<string>(),
  warnings: [],

  loadXmlFile: (xml: string, filePath: string) => {
    try {
      const config = parseERConfiguration(xml, filePath);
      const state = get();
      // Deduplicate by filePath: if the same synthetic/real path is loaded
      // again (e.g. user clicks "Load selected" twice on the same config,
      // or reloads from F&O), replace the previous entry instead of adding
      // a duplicate. Prevents React "two children with the same key"
      // warnings and keeps the tree view tidy.
      const existingIdx = state.configurations.findIndex(c => c.filePath === filePath);
      const newConfigs = existingIdx >= 0
        ? state.configurations.map((c, i) => (i === existingIdx ? config : c))
        : [...state.configurations, config];

      const { registry, treeNodes, warnings } = buildDerivedState(newConfigs);

      // Add recent entry
      const recentName = filePath.split(/[\\/]/).pop() ?? filePath;
      const recentKind = config.content.kind;
      const candidateRecent: RecentFile[] = [
        { path: filePath, name: recentName, kind: recentKind, openedAt: Date.now() },
        ...state.recentFiles.filter(r => r.path !== filePath),
      ].slice(0, MAX_RECENT_FILES);
      const nextRecent = saveRecentFiles(candidateRecent);

      // Build/upsert a recent session that reflects the full set of currently
      // loaded configurations. Older sessions whose file set is a strict
      // subset of the new session are removed so incremental loads collapse.
      const sessionFiles: RecentFile[] = newConfigs.map(c => {
        const cachedFromList = nextRecent.find(r => r.path === c.filePath);
        return {
          path: c.filePath,
          name: c.filePath.split(/[\\/]/).pop() ?? c.filePath,
          kind: c.content.kind,
          openedAt: cachedFromList?.openedAt ?? Date.now(),
        };
      });
      const newSessionId = sessionFingerprint(sessionFiles.map(f => f.path));
      const newSessionPathSet = new Set(sessionFiles.map(f => f.path));
      const keptSessions = state.recentSessions.filter(s => {
        if (s.id === newSessionId) return false;
        if (s.files.length >= sessionFiles.length) return true;
        return !s.files.every(f => newSessionPathSet.has(f.path));
      });
      const candidateSessions: RecentSession[] = [
        { id: newSessionId, openedAt: Date.now(), files: sessionFiles },
        ...keptSessions,
      ].slice(0, MAX_RECENT_SESSIONS);
      const nextSessions = saveRecentSessions(candidateSessions);

      // Persist full XML to IndexedDB (best effort).
      void saveFileContent(filePath, xml);
      const nextCachedPaths = new Set(state.cachedPaths);
      nextCachedPaths.add(filePath);

      set({
        configurations: newConfigs,
        registry,
        treeNodes,
        warnings,
        recentFiles: nextRecent,
        recentSessions: nextSessions,
        cachedPaths: nextCachedPaths,
      });
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
      get().pushToast({ kind: 'error', message: `Chyba při načítání ${fileName}: ${message}` });
      throw e;
    }
  },

  removeConfiguration: (index: number) => {
    const state = get();
    const newConfigs = state.configurations.filter((_, i) => i !== index);
    const { registry, treeNodes, warnings } = buildDerivedState(newConfigs);

    const openTabs: OpenTab[] = state.openTabs
      .filter(tab => tab.configIndex !== index)
      .map(tab => {
        const newConfigIndex = tab.configIndex > index ? tab.configIndex - 1 : tab.configIndex;
        if (tab.kind === 'drillDown') {
          return {
            ...tab,
            configIndex: newConfigIndex,
            id: `drilldown:${newConfigIndex}:${tab.elementName ?? ''}:${tab.expression}`,
          };
        }
        return {
          ...tab,
          id: remapTreeNodeIdAfterRemoval(tab.id, index) ?? tab.id,
          configIndex: newConfigIndex,
        };
      });

    const activeTabId = remapTreeNodeIdAfterRemoval(state.activeTabId, index);
    const selectedNodeId = remapTreeNodeIdAfterRemoval(state.selectedNodeId, index);
    const selectedNode = selectedNodeId ? findNodeById(treeNodes, selectedNodeId) : null;
    const navigationHistory = state.navigationHistory
      .map(snapshot => ({
        activeTabId: remapTreeNodeIdAfterRemoval(snapshot.activeTabId, index),
        selectedNodeId: remapTreeNodeIdAfterRemoval(snapshot.selectedNodeId, index),
      }))
      .filter(snapshot => snapshot.activeTabId != null || snapshot.selectedNodeId != null);

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
      selectedNodeId: selectedNode?.id ?? null,
      selectedNode,
      navigationHistory,
      navigationForward: [],
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: false,
    });
  },

  selectNode: (nodeId: string | null) => {
    if (!nodeId) {
      set({ selectedNodeId: null, selectedNode: null });
      return;
    }
    const state = get();
    const node = findNodeById(state.treeNodes, nodeId);
    set({ selectedNodeId: nodeId, selectedNode: node });
  },

  openTab: (id: string, label: string, configIndex: number) => {
    const state = get();
    const navigationHistory = pushNavigationHistory(state, id, state.selectedNodeId);
    if (!state.openTabs.find(t => t.id === id)) {
      set({
        openTabs: [...state.openTabs, { id, label, configIndex }],
        activeTabId: id,
        navigationHistory,
        navigationForward: [],
        canNavigateBack: navigationHistory.length > 0,
        canNavigateForward: false,
      });
    } else {
      set({
        activeTabId: id,
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
    const newActive = state.activeTabId === id
      ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
      : state.activeTabId;
    set({ openTabs: newTabs, activeTabId: newActive });
  },

  openDrillDownTab: (expression: string, configIndex: number, elementName?: string) => {
    const trimmed = expression.trim();
    if (!trimmed) return;
    const id = `drilldown:${configIndex}:${elementName ?? ''}:${trimmed}`;
    const label = `⚲ ${elementName ?? trimmed.split(/[.(]/)[0] ?? trimmed}`.slice(0, 60);
    const state = get();
    if (!state.openTabs.find(t => t.id === id)) {
      set({
        openTabs: [
          ...state.openTabs,
          { kind: 'drillDown', id, label, configIndex, expression: trimmed, elementName },
        ],
        activeTabId: id,
      });
    } else {
      set({ activeTabId: id });
    }
  },

  setActiveTab: (id: string) => {
    const state = get();
    const navigationHistory = pushNavigationHistory(state, id, state.selectedNodeId);
    set({
      activeTabId: id,
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

  setThemeMode: (mode: ThemeMode) => {
    persistThemeMode(mode);
    set({ themeMode: mode });
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),

  executeSearch: () => {
    const state = get();
    if (!state.searchQuery.trim()) {
      set({ searchResults: [] });
      return;
    }
    const results = state.registry.search(state.searchQuery);
    set({ searchResults: results });
  },

  navigateToTreeNode: (nodeId: string) => {
    const state = get();
    const node = findNodeById(state.treeNodes, nodeId);
    if (!node) return;

    const targetTabId = node.configIndex == null ? state.activeTabId : node.id;
    const navigationHistory = pushNavigationHistory(state, targetTabId, nodeId);

    set({
      selectedNodeId: nodeId,
      selectedNode: node,
      navigationHistory,
      navigationForward: [],
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: false,
    });

    if (node.configIndex == null) return;

    const nextTabId = node.id;

    const targetTabLabel = node.type === 'file'
      ? node.name
      : `${state.configurations[node.configIndex]?.solutionVersion.solution.name ?? node.name} • ${node.name}`;

    const existingTab = state.openTabs.find(t => t.id === nextTabId);
    if (existingTab) {
      set({
        activeTabId: existingTab.id,
        navigationHistory,
        navigationForward: [],
        canNavigateBack: navigationHistory.length > 0,
        canNavigateForward: false,
      });
      return;
    }

    set({
      openTabs: [...state.openTabs, { id: nextTabId, label: targetTabLabel, configIndex: node.configIndex }],
      activeTabId: nextTabId,
      navigationHistory,
      navigationForward: [],
      canNavigateBack: navigationHistory.length > 0,
      canNavigateForward: false,
    });
  },

  navigateBack: () => {
    const state = get();
    if (state.navigationHistory.length === 0) return;

    const history = [...state.navigationHistory];
    const currentSnapshot: NavigationSnapshot = {
      activeTabId: state.activeTabId,
      selectedNodeId: state.selectedNodeId,
    };
    const forward = [...state.navigationForward, currentSnapshot].slice(-50);

    while (history.length > 0) {
      const snapshot = history.pop()!;
      const selectedNode = snapshot.selectedNodeId ? findNodeById(state.treeNodes, snapshot.selectedNodeId) : null;

      let openTabs = state.openTabs;
      let activeTabId = snapshot.activeTabId;

      if (activeTabId && !openTabs.some(tab => tab.id === activeTabId)) {
        if (selectedNode?.configIndex != null) {
          const label = selectedNode.type === 'file'
            ? selectedNode.name
            : `${state.configurations[selectedNode.configIndex]?.solutionVersion.solution.name ?? selectedNode.name} • ${selectedNode.name}`;
          openTabs = [...openTabs, { id: selectedNode.id, label, configIndex: selectedNode.configIndex }];
          activeTabId = selectedNode.id;
        } else {
          activeTabId = openTabs[openTabs.length - 1]?.id ?? null;
        }
      }

      set({
        openTabs,
        activeTabId,
        selectedNodeId: selectedNode?.id ?? null,
        selectedNode,
        navigationHistory: history,
        navigationForward: forward,
        canNavigateBack: history.length > 0,
        canNavigateForward: forward.length > 0,
      });
      return;
    }

    set({ navigationHistory: [], canNavigateBack: false });
  },

  navigateForward: () => {
    const state = get();
    if (state.navigationForward.length === 0) return;
    const forward = [...state.navigationForward];
    const snapshot = forward.pop()!;
    const currentSnapshot: NavigationSnapshot = {
      activeTabId: state.activeTabId,
      selectedNodeId: state.selectedNodeId,
    };
    const history = [...state.navigationHistory, currentSnapshot].slice(-50);
    const selectedNode = snapshot.selectedNodeId ? findNodeById(state.treeNodes, snapshot.selectedNodeId) : null;

    let openTabs = state.openTabs;
    let activeTabId = snapshot.activeTabId;
    if (activeTabId && !openTabs.some(tab => tab.id === activeTabId)) {
      if (selectedNode?.configIndex != null) {
        const label = selectedNode.type === 'file'
          ? selectedNode.name
          : `${state.configurations[selectedNode.configIndex]?.solutionVersion.solution.name ?? selectedNode.name} • ${selectedNode.name}`;
        openTabs = [...openTabs, { id: selectedNode.id, label, configIndex: selectedNode.configIndex }];
        activeTabId = selectedNode.id;
      }
    }

    set({
      openTabs,
      activeTabId,
      selectedNodeId: selectedNode?.id ?? null,
      selectedNode,
      navigationHistory: history,
      navigationForward: forward,
      canNavigateBack: history.length > 0,
      canNavigateForward: forward.length > 0,
    });
  },

  // ─── Toasts ───
  pushToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: Toast = { id, createdAt: Date.now(), ...toast };
    set({ toasts: [...get().toasts, entry] });
    // Auto-dismiss after 6s for non-error kinds.
    if (toast.kind !== 'error') {
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          const current = get().toasts;
          if (current.some(t => t.id === id)) {
            set({ toasts: current.filter(t => t.id !== id) });
          }
        }, 6000);
      }
    }
    return id;
  },
  dismissToast: (id: string) => set({ toasts: get().toasts.filter(t => t.id !== id) }),
  clearToasts: () => set({ toasts: [] }),

  // ─── Tree expansion ───
  isNodeExpanded: (nodeId: string) => get().expandedIds.has(nodeId),
  toggleNodeExpanded: (nodeId: string, defaultExpanded = false) => {
    const current = get().expandedIds;
    const next = new Set(current);
    const isExpanded = current.has(nodeId) ? true : defaultExpanded;
    if (isExpanded) next.delete(nodeId); else next.add(nodeId);
    saveJSON(EXPANDED_IDS_STORAGE_KEY, Array.from(next));
    set({ expandedIds: next });
  },
  setNodeExpanded: (nodeId: string, expanded: boolean) => {
    const next = new Set(get().expandedIds);
    if (expanded) next.add(nodeId); else next.delete(nodeId);
    saveJSON(EXPANDED_IDS_STORAGE_KEY, Array.from(next));
    set({ expandedIds: next });
  },
  expandAll: (rootNodeIds?: string[]) => {
    const next = new Set(get().expandedIds);
    const roots = rootNodeIds ?? get().treeNodes.map(n => n.id);
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        next.add(n.id);
        if (n.children) walk(n.children);
      }
    };
    const byId = (id: string) => findNodeById(get().treeNodes, id);
    for (const id of roots) {
      const root = byId(id);
      if (root) walk([root]);
    }
    saveJSON(EXPANDED_IDS_STORAGE_KEY, Array.from(next));
    set({ expandedIds: next });
  },
  collapseAll: () => {
    saveJSON(EXPANDED_IDS_STORAGE_KEY, []);
    set({ expandedIds: new Set<string>() });
  },
  requestExplorerExpand: (mode) => {
    const current = get().explorerExpandCommand;
    set({ explorerExpandCommand: { mode, version: current.version + 1 } });
  },

  // ─── Recent files ───
  addRecentFile: (file) => {
    const candidate: RecentFile[] = [
      { ...file, openedAt: Date.now() },
      ...get().recentFiles.filter(r => r.path !== file.path),
    ].slice(0, MAX_RECENT_FILES);
    const next = saveRecentFiles(candidate);
    set({ recentFiles: next });
  },
  removeRecentFile: (path: string) => {
    const next = saveRecentFiles(get().recentFiles.filter(r => r.path !== path));
    const nextCachedPaths = new Set(get().cachedPaths);
    nextCachedPaths.delete(path);
    set({ recentFiles: next, cachedPaths: nextCachedPaths });
    void deleteFileContent(path);
  },
  clearRecentFiles: () => {
    saveRecentFiles([]);
    set({ recentFiles: [], cachedPaths: new Set<string>() });
    void clearAllFileContent();
  },
  reloadRecentFile: async (path: string) => {
    const entry = get().recentFiles.find(r => r.path === path);
    if (!entry) return false;
    // Avoid reloading a config that's already loaded under the same path.
    const alreadyLoaded = get().configurations.some(c => c.filePath === entry.path);
    if (alreadyLoaded) return true;
    const content = await readFileContent(path);
    if (!content) {
      get().pushToast({
        kind: 'warning',
        message: `Obsah „${entry.name}“ už není v mezipaměti, otevřete soubor znovu ručně.`,
      });
      return false;
    }
    try {
      get().loadXmlFile(content, entry.path);
      return true;
    } catch {
      return false;
    }
  },

  // ─── Recent sessions ───
  removeRecentSession: (id: string) => {
    const next = saveRecentSessions(get().recentSessions.filter(s => s.id !== id));
    set({ recentSessions: next });
  },
  clearRecentSessions: () => {
    saveRecentSessions([]);
    set({ recentSessions: [] });
  },
  loadRecentSession: async (id: string) => {
    const session = get().recentSessions.find(s => s.id === id);
    if (!session) return false;

    // Fetch all content from IDB up-front so we can reset state only after
    // we know at least one file is actually available.
    const contents = await Promise.all(
      session.files.map(async f => ({ file: f, content: await readFileContent(f.path) })),
    );
    const missing = contents.filter(c => !c.content).map(c => c.file.name);
    const available = contents.filter(c => c.content);
    if (available.length === 0) {
      get().pushToast({
        kind: 'warning',
        message: `Obsah relace už není v mezipaměti, otevřete soubory znovu ručně.`,
      });
      return false;
    }

    // Reset workspace-level state so the session replaces the current analysis.
    set({
      configurations: [],
      registry: new GUIDRegistry(),
      treeNodes: [],
      warnings: [],
      openTabs: [],
      activeTabId: null,
      selectedNodeId: null,
      selectedNode: null,
      navigationHistory: [],
      navigationForward: [],
      canNavigateBack: false,
      canNavigateForward: false,
      searchQuery: '',
      searchResults: [],
    });
    let loaded = 0;
    for (const { file, content } of available) {
      if (!content) continue;
      try {
        get().loadXmlFile(content, file.path);
        loaded++;
      } catch {
        // loadXmlFile already surfaces a toast on parse failure.
      }
    }
    if (missing.length > 0) {
      get().pushToast({
        kind: 'warning',
        message: `Některé soubory v relaci nebyly načteny (chybí mezipaměť): ${missing.join(', ')}.`,
      });
    }
    return loaded > 0;
  },

  resolveDatasource: (expressionOrName: string, fromConfigIndex: number) => {
    const state = get();
    const dsName = expressionOrName.split('.')[0].split('(')[0].replace(/['"]/g, '').trim();
    if (!dsName) return null;

    const searchOrder = [fromConfigIndex, ...state.configurations.map((_, i) => i).filter(i => i !== fromConfigIndex)];

    for (const ci of searchOrder) {
      const config = state.configurations[ci];
      if (!config) continue;

      for (const datasources of getDatasourcePoolsForConfig(config)) {
        const ds = findDatasourceByName(datasources, dsName);
        if (ds) {
          const treeNodeId = get().findDatasourceNode(dsName, ci, ds.parentPath);
          return { configIndex: ci, datasourceName: dsName, treeNodeId, datasource: ds };
        }
      }
    }

    return null;
  },

  resolveBinding: (modelPath: string, fromConfigIndex: number) => {
    const state = get();
    const searchOrder = [fromConfigIndex, ...state.configurations.map((_, i) => i).filter(i => i !== fromConfigIndex)];

    for (const ci of searchOrder) {
      const config = state.configurations[ci];
      if (!config) continue;

      for (const source of getMappingSourcesForConfig(config, ci)) {
        const binding = source.mapping.bindings.find((b: any) => b.path === modelPath);
        if (binding) {
          const treeNodeId = get().findBindingNode(modelPath, ci);
          return { configIndex: ci, treeNodeId, binding };
        }
      }
    }

    return null;
  },

  findDatasourceNode: (dsName: string, configIndex: number, parentPath?: string) => {
    const state = get();
    const rootNode = state.treeNodes[configIndex];
    if (!rootNode) return null;
    const normalizedLookupKey = buildDatasourceLookupKey(dsName, parentPath);
    return findNodeByMatch(
      rootNode,
      n => n.type === 'datasource'
        && buildDatasourceLookupKey(n.name, n.data?.parentPath) === normalizedLookupKey,
    )?.id ?? null;
  },

  findBindingNode: (modelPath: string, configIndex: number) => {
    const state = get();
    const rootNode = state.treeNodes[configIndex];
    if (!rootNode) return null;
    return findNodeByMatch(rootNode, n => n.type === 'binding' && n.data?.path === modelPath)?.id ?? null;
  },

  resolveModelPath: (modelDotPath: string) => {
    const state = get();
    let path = modelDotPath;
    if (path.toLowerCase().startsWith('model.')) path = path.substring(6);
    else if (path.toLowerCase().startsWith('model\\')) path = path.substring(6);

    const normPath = path.replace(/\\/g, '.');
    const segments = parseDottedPath(normPath).filter(Boolean);
    const buildVariants = (segs: string[]) => [
      segs.join('\\'),
      segs.join('.'),
      segs.join('/'),
    ];

    const pathVariants: string[] = [];
    for (let len = segments.length; len >= 1; len--) {
      const segs = segments.slice(0, len);
      for (const v of buildVariants(segs)) {
        if (!pathVariants.includes(v)) pathVariants.push(v);
      }
    }

    for (const source of getAllMappingSources(state.configurations)) {
      for (const tryPath of pathVariants) {
        const binding = source.mapping.bindings.find((b: any) =>
          b.path === tryPath || b.path.toLowerCase() === tryPath.toLowerCase()
        );
        if (!binding) continue;

        const bindingTreeNodeId = get().findBindingNode(binding.path, source.configIndex);
        const dsName = binding.expressionAsString.split(/[.(]/)[0].replace(/['"]/g, '').trim();
        let datasource: any = null;
        let datasourceConfigIndex: number | null = null;
        let datasourceTreeNodeId: string | null = null;
        if (dsName) {
          const dsResult = get().resolveDatasource(dsName, source.configIndex);
          if (dsResult) {
            datasource = dsResult.datasource;
            datasourceConfigIndex = dsResult.configIndex;
            datasourceTreeNodeId = dsResult.treeNodeId;
          }
        }

        return {
          modelPath: binding.path,
          binding,
          bindingConfigIndex: source.configIndex,
          bindingTreeNodeId,
          datasource,
          datasourceConfigIndex,
          datasourceTreeNodeId,
        };
      }
    }
    return null;
  },

  whereUsed: (entityName: string): WhereUsedEntry[] => {
    if (!entityName.trim()) return [];
    const state = get();
    const normalizedEntityName = normalizeIdentifier(entityName);
    const scoredResults: Array<{ score: number; entry: WhereUsedEntry }> = [];

    // Collect all flat datasources (including children) that match
    function collectMatchingDs(datasources: any[]): Array<{ ds: any; match: EntityMatchResult }> {
      const out: Array<{ ds: any; match: any }> = [];
      for (const ds of datasources) {
        const r = getEntityMatch(ds, normalizedEntityName);
        if (r.matched) out.push({ ds, match: r });
        if (ds.children?.length) {
          out.push(...collectMatchingDs(ds.children));
        }
      }
      return out;
    }

    for (let ci = 0; ci < state.configurations.length; ci++) {
      const config = state.configurations[ci];
      const configName = config.solutionVersion.solution.name;

      for (const source of getMappingSourcesForConfig(config, ci)) {
        const mm = source.mapping;
        const matchingDs = collectMatchingDs(mm.datasources);

        for (const { ds, match } of matchingDs) {
          const relatedBindings = mm.bindings.filter((b: any) =>
            expressionReferencesDatasource(b.expressionAsString, ds),
          );

          const modelPaths = relatedBindings.map((b: any) => ({
            path: b.path,
            expr: b.expressionAsString,
            configIndex: ci,
            configName: source.configName,
          }));

          const formatUsages: WhereUsedEntry['formatUsages'] = [];
          for (let fci = 0; fci < state.configurations.length; fci++) {
            const fc = state.configurations[fci];
            if (fc.content.kind !== 'Format') continue;
            const fc2 = fc.content as ERFormatContent;
            const fmtMap = fc2.formatMappingVersion.formatMapping;
            const fmtConfigName = fc.solutionVersion.solution.name;

            const elementNames = new Map<string, { name: string; type: string; path: string[] }>();
            function indexElements(el: any, parentPath: string[]) {
              const here = [...parentPath, el.name];
              elementNames.set(el.id, { name: el.name, type: el.elementType, path: here });
              for (const child of el.children ?? []) indexElements(child, here);
            }
            indexElements(fc2.formatVersion.format.rootElement, []);

            for (const b of fmtMap.bindings) {
              const expr = b.expressionAsString ?? '';
              const isModelRef = expr.toLowerCase().startsWith('model.');
              if (isModelRef) {
                const modelPath = normalizeModelPath(expr.slice(6));
                const matchesPath = modelPaths.some((mp: { path: string }) =>
                  isSameOrDescendantModelPath(modelPath, mp.path),
                );
                if (matchesPath) {
                  const el = elementNames.get(b.componentId);
                  formatUsages.push({
                    elementId: b.componentId,
                    elementName: el?.name ?? b.componentId.slice(1, 9),
                    elementType: el?.type ?? 'Unknown',
                    elementPath: el?.path ?? [],
                    expression: expr,
                    configIndex: fci,
                    configName: fmtConfigName,
                  });
                }
              } else if (expressionReferencesDatasource(expr, ds)) {
                const el = elementNames.get(b.componentId);
                formatUsages.push({
                  elementId: b.componentId,
                  elementName: el?.name ?? b.componentId.slice(1, 9),
                  elementType: el?.type ?? 'Unknown',
                  elementPath: el?.path ?? [],
                  expression: expr,
                  configIndex: fci,
                  configName: fmtConfigName,
                });
              }
            }
          }

          const seenFmt = new Set<string>();
          const uniqueFormatUsages = formatUsages.filter(u => {
            const k = `${u.elementId}:${u.expression}`;
            if (seenFmt.has(k)) return false;
            seenFmt.add(k);
            return true;
          });

          // Skip datasources that have no bindings or format usages — they would
          // render as an empty "Find References" card and only confuse the user.
          if (modelPaths.length === 0 && uniqueFormatUsages.length === 0) continue;

          scoredResults.push({
            score: match.score,
            entry: {
              entityName: match.entityName,
              entityType: match.entityType,
              datasource: {
                name: ds.name,
                parentPath: ds.parentPath,
                configIndex: ci,
                configName: source.configName,
                kind: 'ModelMapping',
              },
              modelPaths,
              formatUsages: uniqueFormatUsages,
            },
          });
        }
      }

      if (config.content.kind === 'Format') {
        const fc = config.content as ERFormatContent;
        const fmtMap = fc.formatMappingVersion.formatMapping;
        const matchingDs = collectMatchingDs(fmtMap.datasources);

        for (const { ds, match } of matchingDs) {
          // Build element name lookup
          const elementNames = new Map<string, { name: string; type: string; path: string[] }>();
          function indexElsFmt(el: any, parentPath: string[]) {
            const here = [...parentPath, el.name];
            elementNames.set(el.id, { name: el.name, type: el.elementType, path: here });
            for (const child of el.children ?? []) indexElsFmt(child, here);
          }
          indexElsFmt(fc.formatVersion.format.rootElement, []);

          // Find format bindings that reference this datasource
          const formatUsages: WhereUsedEntry['formatUsages'] = [];
          for (const b of fmtMap.bindings) {
            const expr = b.expressionAsString ?? '';
            if (expressionReferencesDatasource(expr, ds)) {
              const el = elementNames.get(b.componentId);
              formatUsages.push({
                elementId: b.componentId,
                elementName: el?.name ?? b.componentId.slice(1, 9),
                elementType: el?.type ?? 'Unknown',
                elementPath: el?.path ?? [],
                expression: expr,
                configIndex: ci,
                configName: configName,
              });
            }
          }

          if (formatUsages.length > 0) {
            scoredResults.push({
              score: match.score,
              entry: {
                entityName: match.entityName,
                entityType: match.entityType,
                datasource: {
                  name: ds.name,
                  parentPath: ds.parentPath,
                  configIndex: ci,
                  configName,
                  kind: 'Format',
                },
                modelPaths: [],
                formatUsages,
              },
            });
          }
        }
      }
    }

    // ── Text-reference fallback ──
    // Scan every binding/format expression for the raw query as a case-insensitive
    // identifier (word boundary). This catches table/field/variable names that are
    // used only inside expressions (WHERE(...), IF(...), relations, etc.) and do not
    // correspond to a structural datasource match.
    const textRefEntry = collectExpressionTextMatches(state, entityName);

    if (scoredResults.length === 0 && !textRefEntry) return [];

    const highestScore = scoredResults.length > 0
      ? Math.max(...scoredResults.map(result => result.score))
      : 0;
    const results = scoredResults
      .filter(result => result.score === highestScore)
      .map(result => result.entry);

    const seen = new Set<string>();
    const structural = results.filter(r => {
      const modelPathKey = r.modelPaths.map(mp => `${mp.configIndex}:${normalizeModelPath(mp.path)}`).sort().join('|');
      const formatKey = r.formatUsages.map(u => `${u.configIndex}:${u.elementId}:${u.expression}`).sort().join('|');
      const k = `${r.datasource.configIndex}:${buildDatasourceLookupKey(r.datasource.name, r.datasource.parentPath)}:${r.entityType}:${r.entityName}:${modelPathKey}:${formatKey}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((left, right) => {
      const byEntity = left.entityName.localeCompare(right.entityName, undefined, { sensitivity: 'base' });
      if (byEntity !== 0) return byEntity;
      return left.datasource.name.localeCompare(right.datasource.name, undefined, { sensitivity: 'base' });
    });

    if (textRefEntry) {
      // Dedupe text matches that are already surfaced by a structural match for
      // the same binding/element, to avoid showing the same reference twice.
      const structuralBindingKeys = new Set<string>();
      const structuralFormatKeys = new Set<string>();
      for (const r of structural) {
        for (const mp of r.modelPaths) {
          structuralBindingKeys.add(`${mp.configIndex}:${normalizeModelPath(mp.path)}:${mp.expr}`);
        }
        for (const u of r.formatUsages) {
          structuralFormatKeys.add(`${u.configIndex}:${u.elementId}:${u.expression}`);
        }
      }
      const dedupedModelPaths = textRefEntry.modelPaths.filter(mp =>
        !structuralBindingKeys.has(`${mp.configIndex}:${normalizeModelPath(mp.path)}:${mp.expr}`),
      );
      const dedupedFormatUsages = textRefEntry.formatUsages.filter(u =>
        !structuralFormatKeys.has(`${u.configIndex}:${u.elementId}:${u.expression}`),
      );
      if (dedupedModelPaths.length > 0 || dedupedFormatUsages.length > 0) {
        structural.push({
          ...textRefEntry,
          modelPaths: dedupedModelPaths,
          formatUsages: dedupedFormatUsages,
        });
      }
    }

    return structural;
  },
}));

// Populate the cachedPaths set from IndexedDB on startup so the landing page
// can indicate which recent files/sessions are actually reloadable.
if (typeof window !== 'undefined') {
  void listCachedPaths().then(paths => {
    if (paths.length === 0) return;
    useAppStore.setState({ cachedPaths: new Set(paths) });
  });
}

// ─── Helper: scan every binding/format expression for a raw text occurrence of a query ───

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectExpressionTextMatches(state: AppState, query: string): WhereUsedEntry | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  // Word-boundary, case-insensitive match. Works for identifiers like table/field names.
  const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'i');

  const modelPaths: WhereUsedEntry['modelPaths'] = [];
  const formatUsages: WhereUsedEntry['formatUsages'] = [];

  for (let ci = 0; ci < state.configurations.length; ci++) {
    const config = state.configurations[ci];
    const configName = config.solutionVersion.solution.name;

    if (config.content.kind === 'ModelMapping') {
      const mm = (config.content as ERModelMappingContent).version.mapping;
      for (const b of mm.bindings ?? []) {
        const expr = b.expressionAsString ?? '';
        if (expr && re.test(expr)) {
          modelPaths.push({
            path: b.path,
            expr,
            configIndex: ci,
            configName,
          });
        }
      }
      // Datasource-level expressions (calc fields, user params, groupBy aggregations)
      scanDatasourceExpressions(mm.datasources ?? [], re, ci, configName, state, modelPaths);
      // Validations
      scanValidations(mm.validations ?? [], re, ci, configName, modelPaths);
    } else if (config.content.kind === 'Format') {
      const fc = config.content as ERFormatContent;
      const fmtMap = fc.formatMappingVersion.formatMapping;
      const elementNames = new Map<string, { name: string; type: string; path: string[] }>();
      function indexEls(el: any, parentPath: string[]) {
        const here = [...parentPath, el.name];
        elementNames.set(el.id, { name: el.name, type: el.elementType, path: here });
        for (const child of el.children ?? []) indexEls(child, here);
      }
      indexEls(fc.formatVersion.format.rootElement, []);
      for (const b of fmtMap.bindings ?? []) {
        const expr = b.expressionAsString ?? '';
        if (expr && re.test(expr)) {
          const el = elementNames.get(b.componentId);
          formatUsages.push({
            elementId: b.componentId,
            elementName: el?.name ?? b.componentId.slice(1, 9),
            elementType: el?.type ?? 'Unknown',
            elementPath: el?.path ?? [],
            expression: expr,
            configIndex: ci,
            configName,
          });
        }
      }
      // Format-level datasource expressions
      scanDatasourceExpressions(fmtMap.datasources ?? [], re, ci, configName, state, modelPaths);
      // Embedded model mappings inside format configs
      for (const version of fc.embeddedModelMappingVersions ?? []) {
        for (const b of version.mapping?.bindings ?? []) {
          const expr = b.expressionAsString ?? '';
          if (expr && re.test(expr)) {
            modelPaths.push({
              path: b.path,
              expr,
              configIndex: ci,
              configName,
            });
          }
        }
        scanDatasourceExpressions(version.mapping?.datasources ?? [], re, ci, configName, state, modelPaths);
        scanValidations(version.mapping?.validations ?? [], re, ci, configName, modelPaths);
      }
    }
  }

  if (modelPaths.length === 0 && formatUsages.length === 0) return null;

  return {
    entityName: trimmed,
    entityType: 'TextMatch',
    datasource: {
      name: `"${trimmed}" (výskyty ve výrazech)`,
      configIndex: 0,
      configName: '',
      kind: 'ModelMapping',
    },
    modelPaths,
    formatUsages,
  };
}

/**
 * Walk every datasource (recursively through children) and collect text matches
 * for calculated fields, user-parameter expressions, and groupBy aggregations.
 */
function scanDatasourceExpressions(
  datasources: any[],
  re: RegExp,
  configIndex: number,
  configName: string,
  state: AppState,
  out: WhereUsedEntry['modelPaths'],
): void {
  const rootNode = state.treeNodes[configIndex];
  const locate = (dsName: string, parentPath?: string): string | undefined => {
    if (!rootNode) return undefined;
    const key = buildDatasourceLookupKey(dsName, parentPath);
    const node = findNodeByMatch(
      rootNode,
      n => n.type === 'datasource'
        && buildDatasourceLookupKey(n.name, n.data?.parentPath) === key,
    );
    return node?.id;
  };

  function visit(ds: any) {
    // Calculated field expression
    const calcExpr = ds.calculatedField?.expressionAsString;
    if (calcExpr && re.test(calcExpr)) {
      out.push({
        path: ds.name,
        expr: calcExpr,
        configIndex,
        configName,
        treeNodeId: locate(ds.name, ds.parentPath),
        kindLabel: 'calc',
      });
    }
    // User-parameter expression
    const userExpr = ds.userParamInfo?.expressionAsString;
    if (userExpr && re.test(userExpr)) {
      out.push({
        path: ds.name,
        expr: userExpr,
        configIndex,
        configName,
        treeNodeId: locate(ds.name, ds.parentPath),
        kindLabel: 'param',
      });
    }
    // GroupBy aggregation functions (expression-like) — rarely but possible
    if (ds.groupByInfo) {
      for (const agg of ds.groupByInfo.aggregations ?? []) {
        const aggText = `${agg.function}(${agg.path})`;
        if (agg.path && re.test(agg.path)) {
          out.push({
            path: `${ds.name}/${agg.name}`,
            expr: aggText,
            configIndex,
            configName,
            treeNodeId: locate(ds.name, ds.parentPath),
            kindLabel: 'agg',
          });
        }
      }
    }
    for (const child of ds.children ?? []) visit(child);
  }

  for (const ds of datasources) visit(ds);
}

/** Scan mapping-level validation expressions for text matches. */
function scanValidations(
  validations: any[],
  re: RegExp,
  configIndex: number,
  configName: string,
  out: WhereUsedEntry['modelPaths'],
): void {
  for (const v of validations) {
    for (const rule of v.conditions ?? []) {
      const cond = rule.conditionExpressionAsString ?? '';
      const msg = rule.messageExpressionAsString ?? '';
      if (cond && re.test(cond)) {
        out.push({
          path: v.path || rule.id || 'validation',
          expr: cond,
          configIndex,
          configName,
          kindLabel: 'validation',
        });
      }
      if (msg && re.test(msg)) {
        out.push({
          path: v.path || rule.id || 'validation',
          expr: msg,
          configIndex,
          configName,
          kindLabel: 'message',
        });
      }
    }
  }
}


// ─── Helper: find datasource by name (recursive through children) ───

function findDatasourceByName(datasources: any[], name: string): any | null {
  for (const ds of datasources) {
    if (ds.name === name) return ds;
    if (ds.children) {
      const found = findDatasourceByName(ds.children, name);
      if (found) return found;
    }
  }
  return null;
}

function pushNavigationHistory(
  state: Pick<AppState, 'activeTabId' | 'selectedNodeId' | 'navigationHistory'>,
  nextActiveTabId: string | null,
  nextSelectedNodeId: string | null,
): NavigationSnapshot[] {
  const currentSnapshot: NavigationSnapshot = {
    activeTabId: state.activeTabId,
    selectedNodeId: state.selectedNodeId,
  };

  const nextSnapshot: NavigationSnapshot = {
    activeTabId: nextActiveTabId,
    selectedNodeId: nextSelectedNodeId,
  };

  if (isSameNavigationSnapshot(currentSnapshot, nextSnapshot)) {
    return state.navigationHistory;
  }

  const previous = state.navigationHistory[state.navigationHistory.length - 1];
  if (previous && isSameNavigationSnapshot(previous, currentSnapshot)) {
    return state.navigationHistory;
  }

  return [...state.navigationHistory, currentSnapshot].slice(-50);
}

function isSameNavigationSnapshot(left: NavigationSnapshot, right: NavigationSnapshot): boolean {
  return left.activeTabId === right.activeTabId && left.selectedNodeId === right.selectedNodeId;
}

function normalizeIdentifier(value: string): string {
  return value.replace(/['"]/g, '').trim().toLowerCase();
}

function normalizeModelPath(path: string): string {
  return path
    .replace(/^model[./\\]/i, '')
    .replace(/[./]/g, '\\')
    .replace(/\\+/g, '\\')
    .replace(/^\\|\\$/g, '')
    .toLowerCase();
}

function isSameOrDescendantModelPath(candidate: string, basePath: string): boolean {
  const normalizedCandidate = normalizeModelPath(candidate);
  const normalizedBase = normalizeModelPath(basePath);
  return normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(`${normalizedBase}\\`);
}

function getEntityMatch(ds: any, normalizedQuery: string): EntityMatchResult {
  const candidates: Array<{ entityType: WhereUsedEntry['entityType']; entityName?: string }> = [
    { entityType: 'Table', entityName: ds.tableInfo?.tableName },
    { entityType: 'Enum', entityName: ds.enumInfo?.enumName },
    { entityType: 'Class', entityName: ds.classInfo?.className },
    { entityType: 'UserParameter', entityName: ds.userParamInfo?.extendedDataTypeName },
  ];

  if (ds.name) {
    const datasourceType = mapDatasourceTypeToWhereUsedType(ds.type);
    if (datasourceType) {
      candidates.push({ entityType: datasourceType, entityName: ds.name });
    }
  }

  let bestMatch: EntityMatchResult = {
    matched: false,
    entityType: 'Other',
    entityName: normalizedQuery,
    score: 0,
  };

  for (const candidate of candidates) {
    const entityName = candidate.entityName;
    if (!entityName) continue;

    const normalizedEntity = normalizeIdentifier(entityName);
    const score = getMatchScore(normalizedEntity, normalizedQuery);
    if (score > bestMatch.score) {
      bestMatch = {
        matched: score > 0,
        entityType: candidate.entityType,
        entityName,
        score,
      };
    }
  }

  return bestMatch;
}

function mapDatasourceTypeToWhereUsedType(dsType?: string): WhereUsedEntry['entityType'] | null {
  switch (dsType) {
    case 'CalculatedField':
      return 'CalculatedField';
    case 'GroupBy':
      return 'GroupBy';
    case 'Join':
      return 'Join';
    case 'Container':
      return 'Container';
    case 'Object':
      return 'Object';
    case 'UserParameter':
      return 'UserParameter';
    default:
      return null;
  }
}

function getMatchScore(candidate: string, query: string): 0 | 1 | 2 | 3 {
  if (!candidate || !query) return 0;
  if (candidate === query) return 3;
  if (candidate.startsWith(query)) return 2;
  if (candidate.includes(query)) return 1;
  return 0;
}

function buildDatasourceLookupKey(name: string, parentPath?: string): string {
  const normalizedName = name.replace(/^[$#]/, '').trim().toLowerCase();
  if (!parentPath) return normalizedName;
  const normalizedParent = parentPath
    .split('/')
    .map(segment => segment.trim().replace(/^[$#]/, ''))
    .filter(Boolean)
    .join('/')
    .toLowerCase();
  return normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;
}

function expressionReferencesDatasource(expression: string, ds: any): boolean {
  if (!expression) return false;

  const datasourcePathSegments = buildDatasourcePathSegments(ds);
  const normalizedRootNames = new Set<string>([
    normalizeIdentifier(ds.name),
    normalizeIdentifier(ds.name.replace(/^[$#]/, '')),
  ]);

  for (const reference of extractExpressionReferences(expression)) {
    const segments = parseDottedPath(reference).map(segment => normalizeIdentifier(segment.replace(/^[$#]/, '')));
    const rootSegment = segments[0];
    if (!rootSegment) continue;

    if (matchesDatasourcePath(segments, datasourcePathSegments) || normalizedRootNames.has(rootSegment)) {
      return true;
    }
  }

  return false;
}

function buildDatasourcePathSegments(ds: any): string[] {
  const segments: string[] = [];
  if (typeof ds.parentPath === 'string' && ds.parentPath.trim()) {
    segments.push(
      ...ds.parentPath
        .split('/')
        .map((segment: string) => normalizeIdentifier(segment.replace(/^[$#]/, '')))
        .filter(Boolean),
    );
  }

  segments.push(normalizeIdentifier(String(ds.name ?? '').replace(/^[$#]/, '')));
  return segments.filter(Boolean);
}

function matchesDatasourcePath(referenceSegments: string[], datasourceSegments: string[]): boolean {
  if (referenceSegments.length < datasourceSegments.length || datasourceSegments.length === 0) {
    return false;
  }

  return datasourceSegments.every((segment, index) => referenceSegments[index] === segment);
}

// ─── Deep expression analysis: resolve nested DS paths and trace calculated field dependencies ───

export interface DeepDatasourceInfo {
  name: string;
  type: string;
  tableName?: string;
  enumName?: string;
  enumSourceKind?: 'Ax' | 'DataModel' | 'Format';
  className?: string;
  formula?: string;
  isModelEnum?: boolean;
}

export interface DeepResolutionResult {
  /** The root datasource (e.g. ReportFields) */
  rootDs: any | null;
  rootDsConfigIndex: number | null;
  /** The nested child datasource (e.g. $PurchaseVATDeductionAdjustStandardAmount) */
  nestedDs: any | null;
  /** Full path segments resolved */
  pathSegments: string[];
  /** The calculated field formula (if the resolved DS is a calc field) */
  formula: string | null;
  /** All datasources involved (tables, enums, classes, etc.) found by tracing the formula recursively */
  involvedDatasources: DeepDatasourceInfo[];
  /** Chain of calculated fields traversed */
  calculatedFieldChain: { name: string; formula: string }[];
}

/**
 * Parse a dotted expression path handling quoted segments like ReportFields.'$Field'
 * Returns array of segment names (without quotes).
 */
function parseDottedPath(expr: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === '.') {
      if (current) segments.push(current);
      current = '';
    } else if (ch === '(' || ch === ')' || ch === ' ') {
      // stop at function calls or spaces
      break;
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * Extract all datasource identifiers referenced in an ER expression string.
 * Finds identifiers that appear at the start of dotted paths (e.g. "DS.field" → "DS").
 * Also extracts nested dot-path references like "ReportFields.'$Child'" as full paths.
 */
function extractExpressionReferences(expr: string): string[] {
  if (!expr) return [];
  const refs: string[] = [];
  // Match identifier patterns: word optionally followed by .'quoted' or .word chains
  // This catches: SimpleDS, DS.field, DS.'$Field', ReportFields.'$Child'.value
  const pattern = /(?<![.'"\w])([A-Za-z_]\w*(?:\s*\.\s*(?:'[^']*'|"[^"]*"|[A-Za-z_]\w*))*)/g;
  let match;
  while ((match = pattern.exec(expr)) !== null) {
    const full = match[1].replace(/\s+/g, '');
    // Skip known ER functions and keywords
    if (/^(IF|AND|OR|NOT|ABS|ROUND|FORMAT|TEXT|CONCATENATE|LEFT|RIGHT|MID|LEN|TRIM|REPLACE|FIND|VALUE|INT64VALUE|INTVALUE|INT|NUMBERFORMAT|STRINGJOIN|ORDERBY|WHERE|FILTER|FIRSTORNULL|FIRST|COUNT|SUMIF|SUM|MIN|MAX|AVG|LISTJOIN|SPLIT|EMPTYLIST|ISEMPTY|ENUMERATE|ALLITEMS|ALLITEMSQUERY|REVERSE|VALUEIN|VALUEINLARGE|CONVERTCURRENCY|ROUNDAMOUNT|CH_BANK|FA_BALANCE|FA_SUM|CASE|NUMSEQVALUE|GETENUMVALUEBYNAME|GUIDVALUE|DATETIMEFORMAT|DATEFORMAT|ADDDAYS|SESSIONTODAY|SESSIONNOW|TODAY|NOW|DAYOFYEAR|NULLDATE|NULLDATETIME|DATETIMEVALUE|DATEVALUE|NULLCONTAINER|BASE64STRINGTOCONTAINER|true|false|null)$/i.test(full)) {
      continue;
    }
    refs.push(full);
  }
  return [...new Set(refs)];
}

/**
 * Navigate a datasource tree following a path of segment names.
 * E.g. ["ReportFields", "$PurchaseVATDeductionAdjustStandardAmount"] →
 *   find "ReportFields" root DS, then find "$PurchaseVATDeductionAdjustStandardAmount" child.
 */
function navigateDatasourcePath(datasources: any[], segments: string[]): { rootDs: any | null; leafDs: any | null } {
  if (segments.length === 0) return { rootDs: null, leafDs: null };

  // Find root — strip leading $ if present for matching
  const rootName = segments[0].replace(/^\$/, '');
  let rootDs = findDatasourceByName(datasources, segments[0]) ??
               findDatasourceByName(datasources, rootName);
  if (!rootDs) return { rootDs: null, leafDs: null };

  let current = rootDs;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i].replace(/^\$/, '');
    const child = current.children?.find((c: any) =>
      c.name === segments[i] || c.name === seg || c.name === '$' + seg
    );
    if (!child) break;
    current = child;
  }

  return { rootDs, leafDs: current };
}

/**
 * Recursively trace all datasources involved in a calculated field's expression.
 * Handles nested calculated fields that reference other calculated fields.
 * Searches across all provided datasource pools (from multiple configs).
 */
function traceCalculatedFieldDeps(
  ds: any,
  allDatasourcePools: any[][],
  visited: Set<string>,
  involvedDatasources: DeepDatasourceInfo[],
  calcChain: { name: string; formula: string }[],
): void {
  const dsKey = ds.parentPath ? `${ds.parentPath}/${ds.name}` : ds.name;
  if (visited.has(dsKey)) return; // prevent circular refs
  visited.add(dsKey);

  // Record this DS info
  const info: DeepDatasourceInfo = { name: ds.name, type: ds.type };
  if (ds.tableInfo) info.tableName = ds.tableInfo.tableName;
  if (ds.enumInfo) {
    info.enumName = ds.enumInfo.enumName;
    info.isModelEnum = ds.enumInfo.isModelEnum;
    info.enumSourceKind = ds.enumInfo.sourceKind;
  }
  if (ds.classInfo) info.className = ds.classInfo.className;
  if (ds.calculatedField?.expressionAsString) info.formula = ds.calculatedField.expressionAsString;

  // Only add non-calculated-field datasources as "involved" (tables, enums, classes)
  // Always add if it has concrete type info
  if (ds.tableInfo || ds.enumInfo || ds.classInfo) {
    if (!involvedDatasources.some(d => d.name === ds.name && d.type === ds.type)) {
      involvedDatasources.push(info);
    }
  }

  // If it's a calculated field, trace its formula
  if (ds.calculatedField?.expressionAsString) {
    calcChain.push({ name: ds.name, formula: ds.calculatedField.expressionAsString });
    const refs = extractExpressionReferences(ds.calculatedField.expressionAsString);
    for (const ref of refs) {
      const refSegments = parseDottedPath(ref);
      const found = findDsAcrossPools(allDatasourcePools, refSegments);
      if (found) {
        traceCalculatedFieldDeps(found, allDatasourcePools, visited, involvedDatasources, calcChain);
      }
    }
  }

  // Also trace children that are used
  if (ds.groupByInfo) {
    // GroupBy references a list datasource
    const listRef = ds.groupByInfo.listToGroup;
    if (listRef) {
      const refSegments = parseDottedPath(listRef);
      const found = findDsAcrossPools(allDatasourcePools, refSegments);
      if (found) {
        traceCalculatedFieldDeps(found, allDatasourcePools, visited, involvedDatasources, calcChain);
      }
    }
  }
}

/**
 * Try to find a datasource by navigating a dotted path across multiple datasource pools.
 * Falls back to simple name search if path navigation fails.
 */
function findDsAcrossPools(pools: any[][], segments: string[]): any | null {
  for (const pool of pools) {
    const { leafDs } = navigateDatasourcePath(pool, segments);
    if (leafDs) return leafDs;
  }
  // Fallback: try simple name match for single-segment refs
  if (segments.length === 1) {
    for (const pool of pools) {
      const found = findDatasourceByName(pool, segments[0]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Main deep resolution function: resolve an expression path to its nested datasource
 * and trace all dependencies through calculated fields.
 */
export function resolveDeepExpression(
  expression: string,
  configurations: any[],
  fromConfigIndex: number,
): DeepResolutionResult | null {
  const pathSegments = parseDottedPath(expression);
  if (pathSegments.length === 0) return null;

  // Collect all datasource pools from all configs for cross-config tracing
  const allDatasourcePools: any[][] = [];
  const configDatasources = new Map<number, any[][]>();
  for (let i = 0; i < configurations.length; i++) {
    const config = configurations[i];
    if (!config) continue;
    const pools = getDatasourcePoolsForConfig(config);
    if (pools.length > 0) {
      configDatasources.set(i, pools);
      allDatasourcePools.push(...pools);
    }
  }

  // Search configs for the root DS, starting with fromConfigIndex
  const searchOrder = [fromConfigIndex, ...configurations.map((_: any, i: number) => i).filter((i: number) => i !== fromConfigIndex)];

  for (const ci of searchOrder) {
    const datasourcePools = configDatasources.get(ci);
    if (!datasourcePools) continue;

    let rootDs: any = null;
    let leafDs: any = null;
    for (const datasources of datasourcePools) {
      const resolved = navigateDatasourcePath(datasources, pathSegments);
      if (resolved.rootDs) {
        rootDs = resolved.rootDs;
        leafDs = resolved.leafDs;
        break;
      }
    }
    if (!rootDs) continue;

    const result: DeepResolutionResult = {
      rootDs,
      rootDsConfigIndex: ci,
      nestedDs: leafDs !== rootDs ? leafDs : null,
      pathSegments,
      formula: leafDs?.calculatedField?.expressionAsString ?? null,
      involvedDatasources: [],
      calculatedFieldChain: [],
    };

    // Trace dependencies from the leaf DS across all configs' datasources
    if (leafDs) {
      traceCalculatedFieldDeps(leafDs, allDatasourcePools, new Set(), result.involvedDatasources, result.calculatedFieldChain);
    }

    // If we found something meaningful, return it
    if (result.rootDs) return result;
  }

  return null;
}

function findNodeByMatch(node: TreeNode, predicate: (n: TreeNode) => boolean): TreeNode | null {
  if (predicate(node)) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeByMatch(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

// ─── Tree Building ───

const kindIcons: Record<ERComponentKind, string> = {
  DataModel: '📐',
  ModelMapping: '🔗',
  Format: '📄',
};

function getConfigurationIcon(config: ERConfiguration): string {
  if (config.kind !== 'Format' || config.content.kind !== 'Format') {
    return kindIcons[config.kind] ?? '📄';
  }

  return config.content.direction === 'Import' ? '📥' : '📤';
}

const fieldTypeIcons: Record<number, string> = {
  1: '☑', // Boolean
  3: '#',  // Int64
  4: '#',  // Integer
  5: '🔢', // Real
  6: '📝', // String
  7: '📅', // Date
  9: '🔤', // Enum
  10: '📦', // Container
  11: '📋', // RecordList
  13: '💾', // Binary
};

const dsTypeIcons: Record<string, string> = {
  Table: '🗃️',
  Enum: '🔤',
  ModelEnum: '📋',
  FormatEnum: '🏷️',
  ImportFormat: '📥',
  Class: '⚙️',
  UserParameter: '👤',
  CalculatedField: '🧮',
  GroupBy: '📊',
  Container: '📦',
  Unknown: '❓',
};

const dsGroupOrder = ['Table', 'CalculatedField', 'Class', 'Enum', 'ModelEnum', 'FormatEnum', 'ImportFormat', 'UserParameter', 'GroupBy', 'Container', 'Join', 'Object'];
const dsGroupLabels: Record<string, string> = {
  Table: 'Tables',
  CalculatedField: 'Calculated Fields',
  Class: 'Classes',
  Enum: 'Ax Enums',
  ModelEnum: 'Data model Enums',
  FormatEnum: 'Format enums',
  ImportFormat: 'Import formats',
  UserParameter: 'User Parameters',
  GroupBy: 'Group By',
  Container: 'Containers',
  Join: 'Joins',
  Object: 'Objects',
};

function groupDatasourceNodes(dsNodes: TreeNode[], prefix: string): TreeNode[] {
  const groups = new Map<string, TreeNode[]>();
  for (const node of dsNodes) {
    const type = node.data?.type || 'Unknown';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(node);
  }
  const result: TreeNode[] = [];
  for (const key of dsGroupOrder) {
    const items = groups.get(key);
    if (items && items.length > 0) {
      result.push({
        id: `${prefix}-dsgrp-${key}`,
        name: `${dsGroupLabels[key] ?? key} (${items.length})`,
        icon: dsTypeIcons[key] ?? '❓',
        type: 'section',
        children: items,
      });
      groups.delete(key);
    }
  }
  for (const [key, items] of groups) {
    result.push({
      id: `${prefix}-dsgrp-${key}`,
      name: `${dsGroupLabels[key] ?? key} (${items.length})`,
      icon: dsTypeIcons[key] ?? '❓',
      type: 'section',
      children: items,
    });
  }
  return result;
}

const groupedFieldSectionAliases = new Set(['groupbyfields', 'grouped', 'groupedfields', 'groupby', 'groupfields']);
const aggregatedSectionAliases = new Set(['aggregated', 'aggregation', 'aggregations']);

function getGroupBySectionKind(name: string | undefined): 'groupedFields' | 'aggregations' | null {
  const normalizedName = (name ?? '').trim().toLowerCase().replace(/^[$#]/, '');
  if (groupedFieldSectionAliases.has(normalizedName)) return 'groupedFields';
  if (aggregatedSectionAliases.has(normalizedName)) return 'aggregations';
  return null;
}

function collectDatasourceDescendants(datasource: any): any[] {
  const result: any[] = [];

  for (const child of datasource.children ?? []) {
    result.push(child);
    result.push(...collectDatasourceDescendants(child));
  }

  return result;
}

function findDatasourceByNormalizedPath(datasource: any, path: string): any | null {
  const normalizedPath = path.trim().toLowerCase();
  const descendants = collectDatasourceDescendants(datasource);

  for (const child of descendants) {
    const childPath = [child.parentPath, child.name]
      .filter(Boolean)
      .join('/');
    const normalizedChildPath = childPath
      .split('/')
      .map((segment: string) => segment.trim())
      .filter(Boolean)
      .map((segment: string, index: number) => segment.replace(index === 0 ? /^#/ : /^\$/, ''))
      .join('/')
      .toLowerCase();

    if (normalizedChildPath === normalizedPath) {
      return child;
    }
  }

  return null;
}

function buildMappingTree(mapping: any, prefix: string, configIndex: number): TreeNode {
  const dsNodes = mapping.datasources.map((ds: any, di: number) =>
    buildDatasourceTree(ds, `${prefix}-ds-${di}`, configIndex),
  );

  const bindingNodes = mapping.bindings.map((binding: any, bi: number) => ({
    id: `${prefix}-binding-${bi}`,
    name: binding.path,
    icon: '↔️',
    type: 'binding' as const,
    data: binding,
    configIndex,
  }));

  const validationNodes = mapping.validations.map((validation: any, vi: number) => ({
    id: `${prefix}-val-${vi}`,
    name: validation.path,
    icon: '✅',
    type: 'validation' as const,
    data: validation,
    configIndex,
  }));

  return {
    id: prefix,
    name: `Mapping: ${mapping.name}`,
    icon: '🔗',
    type: 'mapping',
    configIndex,
    data: mapping,
    children: [
      { id: `${prefix}-ds-section`, name: `Data Sources (${dsNodes.length})`, icon: '📂', type: 'section', children: groupDatasourceNodes(dsNodes, prefix) },
      { id: `${prefix}-bind-section`, name: `Bindings (${bindingNodes.length})`, icon: '📂', type: 'section', children: bindingNodes },
      { id: `${prefix}-val-section`, name: `Validations (${validationNodes.length})`, icon: '📂', type: 'section', children: validationNodes },
    ],
  };
}

function buildTreeForConfig(config: ERConfiguration, index: number): TreeNode {
  const sol = config.solutionVersion.solution;
  const children: TreeNode[] = [];
  const prefix = `cfg-${index}`;

  if (config.content.kind === 'DataModel') {
    const dm = (config.content as ERDataModelContent).version;
    const containerNodes = dm.model.containers.map((c, ci) => ({
      id: `${prefix}-container-${ci}`,
      name: c.name,
      icon: c.isEnum ? '🔤' : c.isRoot ? '🏠' : '📦',
      type: 'container' as const,
      data: c,
      configIndex: index,
      children: c.items.map((item, fi) => ({
        id: `${prefix}-container-${ci}-field-${fi}`,
        name: item.name,
        icon: fieldTypeIcons[item.type] ?? '❓',
        type: 'field' as const,
        data: item,
        configIndex: index,
      })),
    }));

    children.push(
      {
        id: `${prefix}-model-roots`,
        name: 'Root Containers',
        icon: '📂',
        type: 'section',
        children: containerNodes.filter(c => c.data.isRoot),
      },
      {
        id: `${prefix}-model-enums`,
        name: 'Enumerations',
        icon: '📂',
        type: 'section',
        children: containerNodes.filter(c => c.data.isEnum),
      },
      {
        id: `${prefix}-model-records`,
        name: 'Records',
        icon: '📂',
        type: 'section',
        children: containerNodes.filter(c => !c.data.isRoot && !c.data.isEnum),
      },
    );
  }

  if (config.content.kind === 'ModelMapping') {
    const mm = (config.content as ERModelMappingContent).version;
    const inner = buildMappingTree(mm.mapping, `${prefix}-mapping`, index);
    children.push(...(inner.children ?? []));
  }

  if (config.content.kind === 'Format') {
    const fc = config.content as ERFormatContent;
    const fmt = fc.formatVersion;
    const fmtMap = fc.formatMappingVersion;

    const formatTree = buildFormatElementTree(fmt.format.rootElement, `${prefix}-fmt`, index);

    const fmtBindingPresentation = buildFormatBindingPresentation(fmt.format.rootElement, fmtMap.formatMapping.bindings);

    const fmtBindingTypeGroups = new Map<string, typeof fmtBindingPresentation.groups>();
    for (const bindingGroup of fmtBindingPresentation.groups) {
      const existing = fmtBindingTypeGroups.get(bindingGroup.elementType) ?? [];
      existing.push(bindingGroup);
      fmtBindingTypeGroups.set(bindingGroup.elementType, existing);
    }

    const fmtBindNodes = Array.from(fmtBindingTypeGroups.entries())
      .sort(([leftType], [rightType]) => leftType.localeCompare(rightType))
      .map(([elementType, groups], typeIndex) => ({
        id: `${prefix}-fmtbind-type-${typeIndex}`,
        name: `${elementType} (${groups.length})`,
        icon: '📂',
        type: 'section' as const,
        children: groups
          .sort((left, right) => left.elementName.localeCompare(right.elementName))
          .map((g, bi) => {
            const primaryDataExpr = g.dataBindings[0]?.expressionAsString ?? '';
            const nonDataCategories = g.categories.filter(category => category.key !== 'data');
            const label = primaryDataExpr
              ? `${g.elementName}  ←  ${primaryDataExpr.substring(0, 50)}`
              : `${g.elementName} (${nonDataCategories.map(category => `${category.label}: ${category.bindings.length}`).join(', ') || 'no bindings'})`;
            return {
              id: `${prefix}-fmtbind-${typeIndex}-${bi}`,
              name: label,
              icon: primaryDataExpr ? '↔️' : '⚙️',
              type: 'formatBinding' as const,
              data: { componentId: g.componentId, expressionAsString: primaryDataExpr, propBindings: g.bindings.filter(binding => binding.bindingCategory !== 'data') },
              configIndex: index,
              children: nonDataCategories.length > 0 ? nonDataCategories.map((category, ci) => ({
                id: `${prefix}-fmtbind-${typeIndex}-${bi}-cat-${ci}`,
                name: `${category.label} (${category.bindings.length})`,
                icon: '📂',
                type: 'section' as const,
                children: category.bindings.map((binding, pi) => ({
                  id: `${prefix}-fmtbind-${typeIndex}-${bi}-cat-${ci}-prop-${pi}`,
                  name: `${binding.bindingDisplayLabel}  ←  ${binding.expressionAsString.substring(0, 45)}`,
                  icon: category.key === 'visibility' ? '👁️' : '⚙️',
                  type: 'formatBinding' as const,
                  data: binding,
                  configIndex: index,
                })),
              })) : undefined,
            };
          }),
      }));

    const enumNodes = fmt.format.enumDefinitions.map((e, ei) => ({
      id: `${prefix}-enum-${ei}`,
      name: e.name,
      icon: '🔤',
      type: 'enum' as const,
      data: e,
      configIndex: index,
      children: e.values.map((v, vi) => ({
        id: `${prefix}-enum-${ei}-val-${vi}`,
        name: v.name,
        icon: '·',
        type: 'enumValue' as const,
        data: v,
        configIndex: index,
      })),
    }));

    const transNodes = fmt.format.transformations.map((t, ti) => ({
      id: `${prefix}-trans-${ti}`,
      name: t.name,
      icon: '🔄',
      type: 'transformation' as const,
      data: t,
      configIndex: index,
    }));

    const fmtDsNodes = fmtMap.formatMapping.datasources.map((ds, di) =>
      buildDatasourceTree(ds, `${prefix}-fmtds-${di}`, index),
    );
    const embeddedMappingNodes = fc.embeddedModelMappingVersions.map((version, embeddedIndex) =>
      buildMappingTree(version.mapping, `${prefix}-embedded-mapping-${embeddedIndex}`, index),
    );

    children.push(
      { id: `${prefix}-fmt-structure`, name: 'Output Structure', icon: '📂', type: 'section', children: [formatTree] },
      ...(embeddedMappingNodes.length > 0 ? [{ id: `${prefix}-fmt-embedded-mappings`, name: `Model Mappings (${embeddedMappingNodes.length})`, icon: '📂', type: 'section' as const, children: embeddedMappingNodes }] : []),
      { id: `${prefix}-fmt-enums`, name: `Enumerations (${enumNodes.length})`, icon: '📂', type: 'section', children: enumNodes },
      { id: `${prefix}-fmt-trans`, name: `Transformations (${transNodes.length})`, icon: '📂', type: 'section', children: transNodes },
      { id: `${prefix}-fmt-ds`, name: `Data Sources (${fmtDsNodes.length})`, icon: '📂', type: 'section', children: groupDatasourceNodes(fmtDsNodes, `${prefix}-fmt`) },
      { id: `${prefix}-fmt-bindings`, name: `Bindings (${fmtBindNodes.length})`, icon: '📂', type: 'section', children: fmtBindNodes },
    );
  }

  return {
    id: prefix,
    name: sol.name,
    icon: getConfigurationIcon(config),
    type: 'file',
    configIndex: index,
    data: config,
    children,
  };
}

function buildDatasourceTree(ds: any, prefix: string, configIndex: number): TreeNode {
  const regularChildren = (ds.children ?? []).filter((child: any) => {
    return getGroupBySectionKind(child.name) == null;
  });

  const groupedFieldNodes = (ds.groupByInfo?.groupedFields ?? [])
    .map((field: any, index: number) => {
      const matchedDatasource = findDatasourceByNormalizedPath(ds, field.path);
      return matchedDatasource
        ? buildDatasourceTree(matchedDatasource, `${prefix}-grouped-field-${index}`, configIndex)
        : null;
    })
    .filter((node: TreeNode | null): node is TreeNode => node != null);

  const aggregatedFieldNodes = (ds.groupByInfo?.aggregations ?? [])
    .map((field: any, index: number) => {
      const matchedDatasource = findDatasourceByNormalizedPath(ds, field.path);
      return matchedDatasource
        ? buildDatasourceTree(matchedDatasource, `${prefix}-aggregated-field-${index}`, configIndex)
        : null;
    })
    .filter((node: TreeNode | null): node is TreeNode => node != null);

  const children = ds.type === 'GroupBy'
    ? [
        ...(groupedFieldNodes.length > 0
          ? [{
              id: `${prefix}-groupby-fields`,
              name: `Grouped By (${groupedFieldNodes.length})`,
              icon: '📂',
              type: 'section' as const,
              children: groupedFieldNodes,
            }]
          : []),
        ...(aggregatedFieldNodes.length > 0
          ? [{
              id: `${prefix}-aggregated-fields`,
              name: `Aggregated (${aggregatedFieldNodes.length})`,
              icon: '📂',
              type: 'section' as const,
              children: aggregatedFieldNodes,
            }]
          : []),
        ...regularChildren.map((child: any, i: number) =>
          buildDatasourceTree(child, `${prefix}-${i}`, configIndex),
        ),
      ]
    : (ds.children ?? []).map((child: any, i: number) =>
        buildDatasourceTree(child, `${prefix}-${i}`, configIndex),
      );

  return {
    id: prefix,
    name: ds.name,
    icon: dsTypeIcons[ds.type] ?? '❓',
    type: 'datasource',
    data: ds,
    configIndex,
    children,
  };
}

function buildFormatElementTree(element: any, prefix: string, configIndex: number): TreeNode {
  const typeIcons: Record<string, string> = {
    File: '📁',
    XMLElement: '🏷️',
    XMLAttribute: '@',
    XMLSequence: '🔁',
    String: '📝',
    Base64: '💾',
    Unknown: '❓',
  };

  return {
    id: prefix,
    name: element.name || element.elementType,
    icon: typeIcons[element.elementType] ?? '❓',
    type: 'formatElement',
    data: element,
    configIndex,
    children: element.children?.map((child: any, i: number) =>
      buildFormatElementTree(child, `${prefix}-${i}`, configIndex),
    ),
  };
}
