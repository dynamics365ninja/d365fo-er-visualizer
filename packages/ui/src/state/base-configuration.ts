/**
 * The base a derived configuration was made from — the `Base` of its solution:
 * a format derived from a Microsoft format, a model or mapping extended by a
 * partner. Where a copy of it can be had for a comparison: loaded in the
 * workspace, in the cache of recent configurations, or from F&O.
 */
import type { ERConfiguration } from '@er-visualizer/core';
import type { ErComponentType, ErConfigSummary } from '@er-visualizer/fno-client';
import { compareConfigVersions, normalizeSolutionId } from './configuration-merge';
import type { RecentFile } from './persistence';

export interface BaseReference {
  /** Solution GUID of the base. */
  id: string;
  /** The base version the configuration was derived from. */
  version?: number;
  name?: string;
}

export function baseReference(cfg: ERConfiguration | undefined): BaseReference | undefined {
  const solution = cfg?.solutionVersion?.solution;
  const id = normalizeSolutionId(solution?.baseSolutionId);
  if (!solution || !id || /^0{8}-?0{4}-?0{4}-?0{4}-?0{12}$/.test(id)) return undefined;
  return { id, version: solution.baseVersion, name: solution.baseName };
}

/**
 * Whether a version, as the explorer shows it, is the one the derived
 * configuration was made from. `Base` names the base's own revision; a public
 * version (`136.115.106`) ends with it.
 */
export function isDerivedFromVersion(version: string | number | undefined, base: BaseReference | undefined): boolean {
  if (base?.version == null || version == null || version === '') return false;
  const text = String(version);
  return text === String(base.version) || text.split('.').pop() === String(base.version);
}

/** Whether a loaded or parsed base is the very version the configuration was derived from. */
export function isExactBase(candidate: ERConfiguration, cfg: ERConfiguration): boolean {
  const base = baseReference(cfg);
  return candidate.solutionVersion.number === base?.version
    || isDerivedFromVersion(candidate.solutionVersion.publicVersionNumber, base);
}

/** Whether `candidate` is (a version of) the base of `cfg`. */
export function isBaseOf(candidate: ERConfiguration, cfg: ERConfiguration): boolean {
  const base = baseReference(cfg);
  return Boolean(base && normalizeSolutionId(candidate.solutionVersion?.solution?.id) === base.id);
}

/**
 * The loaded configuration a derived one was made from, of any kind: the base
 * of a root format is its data model, which has nothing to compare with.
 */
export function loadedBase(configurations: readonly ERConfiguration[], cfg: ERConfiguration): { index: number; config: ERConfiguration } | undefined {
  const index = configurations.findIndex(candidate => candidate !== cfg && isBaseOf(candidate, cfg));
  return index >= 0 ? { index, config: configurations[index] } : undefined;
}

/**
 * What is known about the base's kind, from the workspace and the recent
 * configurations: the same as the configuration's (a derived format's base
 * format), another (the data model a root format or mapping hangs under), or
 * nothing yet — then only F&O or a file can tell.
 */
export function knownBaseKind(
  configurations: readonly ERConfiguration[],
  recentFiles: readonly RecentFile[],
  cfg: ERConfiguration,
): { kind: 'same' } | { kind: 'other'; name: string; configKind: 'DataModel' | 'ModelMapping' | 'Format' } | { kind: 'unknown' } {
  const base = baseReference(cfg);
  if (!base) return { kind: 'unknown' };
  const loaded = configurations.filter(candidate => candidate !== cfg && isBaseOf(candidate, cfg));
  const recent = recentFiles.filter(file => normalizeSolutionId(file.solutionId) === base.id);
  if (loaded.some(c => c.content.kind === cfg.content.kind) || recent.some(f => f.kind === cfg.content.kind)) return { kind: 'same' };
  const other = loaded[0];
  if (other) return { kind: 'other', name: other.solutionVersion.solution.name, configKind: other.content.kind as 'DataModel' | 'ModelMapping' | 'Format' };
  const otherRecent = recent.find(f => f.kind);
  if (otherRecent?.kind) return { kind: 'other', name: otherRecent.solutionName ?? otherRecent.name, configKind: otherRecent.kind };
  return { kind: 'unknown' };
}

/**
 * Cached versions of the base, of the configuration's kind: the version it was
 * derived from first, then the others newest first.
 */
export function cachedBaseVersions(
  recentFiles: readonly RecentFile[],
  cachedPaths: ReadonlySet<string>,
  cfg: ERConfiguration,
): RecentFile[] {
  const base = baseReference(cfg);
  if (!base) return [];
  const exact = (file: RecentFile) => Number(isDerivedFromVersion(file.version, base));
  return recentFiles
    .filter(file => file.kind === cfg.content.kind && normalizeSolutionId(file.solutionId) === base.id)
    .filter(file => cachedPaths.has(file.path) || (file.bundlePath ? cachedPaths.has(file.bundlePath) : false))
    .sort((a, b) => exact(b) - exact(a)
      || compareConfigVersions(b.version, a.version)
      || b.openedAt - a.openedAt);
}

/** Version numbers tried for a data model base whose listing row is not at hand. */
const MODEL_VERSIONS = [50, 40, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

/**
 * What to ask F&O for to get the base: the same kind of component under the
 * base's GUID. F&O's services serve the effective (completed) version only.
 */
export function baseDownloadSpec(cfg: ERConfiguration): ErConfigSummary | undefined {
  const base = baseReference(cfg);
  if (!base) return undefined;
  const kind = cfg.content.kind as ErComponentType;
  const guid = `{${base.id}}`;
  const name = base.name || `${kind} ${guid}`;
  return {
    solutionName: name,
    configurationName: name,
    componentType: kind,
    configurationGuid: guid,
    revisionGuid: kind === 'Format' ? guid : undefined,
    version: base.version != null ? String(base.version) : undefined,
    versionNumbers: kind === 'DataModel'
      ? [...(base.version != null ? [base.version] : []), ...MODEL_VERSIONS.filter(v => v !== base.version)]
      : undefined,
    hasContent: true,
  };
}
