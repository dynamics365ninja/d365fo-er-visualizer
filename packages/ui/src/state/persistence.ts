/**
 * Recent files and sessions as persisted in localStorage (metadata only —
 * the XML itself lives in the IndexedDB content cache), plus the stored
 * technical-details preference.
 */
import type { ERConfiguration, ERFormatContent } from '@er-visualizer/core';
import { formatReferencedModelIds } from '../utils/model-hierarchy';

const TECHNICAL_DETAILS_STORAGE_KEY = 'er-visualizer.showTechnicalDetails';
export const RECENT_FILES_STORAGE_KEY = 'er-visualizer.recentFiles.v1';
export const RECENT_SESSIONS_STORAGE_KEY = 'er-visualizer.recentSessions.v1';
export const MAX_RECENT_FILES = 60;
const MAX_RECENT_SESSIONS = 12;

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
  /** Human-readable configuration name (ERSolution.Name). */
  solutionName?: string;
  /** Public version as shown in the explorer pill. */
  version?: string;
  /**
   * DataModel component GUID this configuration is tied to: the model's own
   * `ERDataModel ID.` for a DataModel, the referenced `modelId` for a
   * ModelMapping / Format. Lets the workspace manager offer the related
   * model + mapping when a format is re-opened.
   */
  modelId?: string;
  /** Solution wrapper GUID (`ERSolution ID.`). */
  solutionId?: string;
  /** Where the XML came from. */
  source?: 'file' | 'fno';
  /**
   * For configurations extracted from a bundle (`…#datamodel:{guid}`) the
   * cached XML lives under the outer file path; re-loading that path brings
   * the extract back too.
   */
  bundlePath?: string;
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

/**
 * Read a persisted JSON value and hand it to `sanitize`, which has to turn
 * whatever is stored — another build's shape, `"null"`, a hand-edited value —
 * into a valid `T`. Parse failures fall back to `fallback`.
 */
export function loadJSON<T>(key: string, fallback: T, sanitize: (value: unknown) => T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return sanitize(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const RECENT_FILE_KINDS: ReadonlySet<unknown> = new Set(['DataModel', 'ModelMapping', 'Format']);

/**
 * Keep the persisted recent-file entries that are usable: a non-array value
 * yields `[]`, entries without a string `path` are dropped, and optional
 * fields of the wrong type are removed rather than trusted.
 */
export function sanitizeRecentFiles(value: unknown): RecentFile[] {
  if (!Array.isArray(value)) return [];
  const files: RecentFile[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.path !== 'string' || !item.path) continue;
    const file: RecentFile = {
      path: item.path,
      name: typeof item.name === 'string' ? item.name : (item.path.split(/[\\/]/).pop() ?? item.path),
      openedAt: typeof item.openedAt === 'number' && Number.isFinite(item.openedAt) ? item.openedAt : 0,
    };
    if (RECENT_FILE_KINDS.has(item.kind)) file.kind = item.kind as RecentFile['kind'];
    if (typeof item.solutionName === 'string') file.solutionName = item.solutionName;
    if (typeof item.version === 'string') file.version = item.version;
    if (typeof item.modelId === 'string') file.modelId = item.modelId;
    if (typeof item.solutionId === 'string') file.solutionId = item.solutionId;
    if (item.source === 'file' || item.source === 'fno') file.source = item.source;
    if (typeof item.bundlePath === 'string') file.bundlePath = item.bundlePath;
    files.push(file);
  }
  return files;
}

/** Same as `sanitizeRecentFiles` for sessions; a session left with no files is dropped. */
export function sanitizeRecentSessions(value: unknown): RecentSession[] {
  if (!Array.isArray(value)) return [];
  const sessions: RecentSession[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const files = sanitizeRecentFiles(item.files);
    if (files.length === 0) continue;
    sessions.push({
      id: item.id,
      openedAt: typeof item.openedAt === 'number' && Number.isFinite(item.openedAt) ? item.openedAt : 0,
      files,
    });
  }
  return sessions;
}

/**
 * Persist the recent-files list. Cached XML content lives in IndexedDB, so
 * localStorage only ever sees the metadata subset.
 */
export function saveRecentFiles(files: RecentFile[]): RecentFile[] {
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
export function saveRecentSessions(sessions: RecentSession[]): RecentSession[] {
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

/**
 * The content-cache key a configuration path is stored under. A bundled
 * extract (`bundle.xml#datamodel:{guid}`) has no cache entry of its own — the
 * bundle's XML is cached once, and loading it brings every extract back.
 */
export function bundleContentPath(path: string): string {
  return path.replace(/#datamodel:.*$/, '');
}

/**
 * A session remembers each configuration the way the recent-files list does
 * (name, version, source) — it used to keep only the file name, so an F&O
 * download showed up as its synthetic `fno://…` key.
 */
function buildRecentSessionFiles(configurations: ERConfiguration[], recentFiles: RecentFile[]): RecentFile[] {
  return configurations.map(config => {
    const known = recentFiles.find(entry => entry.path === config.filePath);
    const source = known?.source ?? (config.filePath.startsWith('fno://') ? 'fno' : 'file');
    return {
      ...describeRecentFile(config, source),
      bundlePath: known?.bundlePath,
      openedAt: known?.openedAt ?? Date.now(),
    };
  });
}

export function deriveRecentSessionsAfterConfigChange(
  previousConfigs: ERConfiguration[],
  nextConfigs: ERConfiguration[],
  recentSessions: RecentSession[],
  recentFiles: RecentFile[],
): RecentSession[] {
  // Closing everything leaves the last workspace in the history — reopening
  // it is what the list is for. Only a workspace that is still open follows
  // the configurations as they are closed one by one.
  if (nextConfigs.length === 0) return recentSessions;

  const previousSessionId = previousConfigs.length > 0
    ? sessionFingerprint(previousConfigs.map(config => config.filePath))
    : null;

  const baseSessions = recentSessions.filter(session => session.id !== previousSessionId);

  const nextSessionFiles = buildRecentSessionFiles(nextConfigs, recentFiles);
  const nextSessionId = sessionFingerprint(nextSessionFiles.map(file => file.path));
  const nextSessionPathSet = new Set(nextSessionFiles.map(file => file.path));

  return [
    { id: nextSessionId, openedAt: Date.now(), files: nextSessionFiles },
    ...baseSessions.filter(session => {
      if (session.id === nextSessionId) return false;
      if (session.files.length >= nextSessionFiles.length) return true;
      return !session.files.every(file => nextSessionPathSet.has(file.path));
    }),
  ].slice(0, MAX_RECENT_SESSIONS);
}

function normGuidKey(g: string | undefined): string {
  return (g ?? '').replace(/^\{|\}$/g, '').toLowerCase();
}

/** Model GUID a configuration is tied to (see `RecentFile.modelId`). */
export function configurationModelId(cfg: ERConfiguration): string | undefined {
  const content = cfg.content as unknown as {
    kind: string;
    version?: { model?: { id?: string }; mapping?: { modelId?: string } };
    embeddedModelMappingVersions?: Array<{ mapping?: { modelId?: string } }>;
  };
  if (content.kind === 'DataModel') return normGuidKey(content.version?.model?.id) || undefined;
  if (content.kind === 'ModelMapping') return normGuidKey(content.version?.mapping?.modelId) || undefined;
  return formatReferencedModelIds(cfg.content as ERFormatContent)[0];
}

/** Metadata snapshot of a configuration for the recent-files list. */
export function describeRecentFile(cfg: ERConfiguration, source: 'file' | 'fno'): Omit<RecentFile, 'openedAt'> {
  const fileName = cfg.filePath.split(/[\\/]/).pop() ?? cfg.filePath;
  const publicVersion = cfg.solutionVersion.publicVersionNumber
    || (cfg.solutionVersion.number > 0 ? String(cfg.solutionVersion.number) : '');
  return {
    path: cfg.filePath,
    name: fileName.replace(/#datamodel:.*$/, ''),
    kind: cfg.content.kind,
    solutionName: cfg.solutionVersion.solution.name || undefined,
    version: publicVersion || undefined,
    modelId: configurationModelId(cfg),
    solutionId: normGuidKey(cfg.solutionVersion.solution.id) || undefined,
    source,
  };
}

export interface RelatedRecentFiles {
  dataModel?: RecentFile;
  mappings: RecentFile[];
  formats: RecentFile[];
}

/**
 * Cached-but-not-loaded configurations that belong to the same data model as
 * `entry`. Used to ask "load the model and its mapping too?" when a format or
 * mapping is (re-)added to the workspace.
 */
export function findRelatedRecentFiles(
  entry: RecentFile,
  recentFiles: readonly RecentFile[],
  configurations: readonly ERConfiguration[],
  cachedPaths: ReadonlySet<string>,
): RelatedRecentFiles {
  const result: RelatedRecentFiles = { mappings: [], formats: [] };
  if (!entry.modelId) return result;
  const loadedPaths = new Set(configurations.map(c => c.filePath));
  const loadedModelIds = new Set(
    configurations.filter(c => c.content.kind === 'DataModel').map(c => configurationModelId(c)).filter(Boolean),
  );
  const loadedMappingModelIds = new Set(
    configurations.filter(c => c.content.kind === 'ModelMapping').map(c => configurationModelId(c)).filter(Boolean),
  );
  const seen = new Set<string>();
  for (const other of recentFiles) {
    if (other.path === entry.path || other.modelId !== entry.modelId) continue;
    if (loadedPaths.has(other.path) || seen.has(other.path)) continue;
    if (!cachedPaths.has(other.path) && !(other.bundlePath && cachedPaths.has(other.bundlePath))) continue;
    seen.add(other.path);
    if (other.kind === 'DataModel') {
      if (!loadedModelIds.has(other.modelId) && !result.dataModel) result.dataModel = other;
    } else if (other.kind === 'ModelMapping') {
      if (entry.kind !== 'ModelMapping' && !loadedMappingModelIds.has(other.modelId)) result.mappings.push(other);
    } else if (other.kind === 'Format' && entry.kind === 'DataModel') {
      result.formats.push(other);
    }
  }
  return result;
}

export function readStoredTechnicalDetails(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TECHNICAL_DETAILS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function persistTechnicalDetails(show: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TECHNICAL_DETAILS_STORAGE_KEY, String(show));
  } catch {
    // Ignore storage failures and keep in-memory state only.
  }
}
