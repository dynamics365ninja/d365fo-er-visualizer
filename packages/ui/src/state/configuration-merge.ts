/**
 * Merging a freshly parsed configuration into the loaded set: same path,
 * same data model or same solution GUID replace the older entry.
 */
import type { ERConfiguration } from '@er-visualizer/core';

/**
 * Normalise a solution GUID to a comparable lowercase string without
 * surrounding curly braces (both "{guid}" and "guid" inputs work).
 */
export function normalizeSolutionId(id: string | undefined): string {
  return (id ?? '').replace(/^\{|\}$/g, '').toLowerCase();
}

/**
 * Compare two configuration version strings segment by segment, numerically.
 * Handles both simple integers ("68") and multi-part versions ("68.12",
 * "1.68.1234") — "68.12" sorts before "68.13", and a missing trailing segment
 * counts as 0. An empty or unparseable version is treated as oldest so that a
 * config without version info can be replaced. Returns a negative number when
 * `a` is older than `b`, positive when newer, and 0 when equal.
 */
export function compareConfigVersions(
  a: string | undefined | null,
  b: string | undefined | null,
): number {
  const left = versionSegments(a);
  const right = versionSegments(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function versionSegments(version: string | undefined | null): number[] {
  if (!version) return [];
  return (String(version).match(/\d+/g) ?? []).map(part => parseInt(part, 10));
}

/**
 * Insert `config` into `configs`, replacing an entry with the same path or the
 * same solution GUID + kind. Returns `null` when an already-loaded entry is a
 * newer version and the candidate should be dropped.
 */
export function mergeConfiguration(
  configs: ERConfiguration[],
  config: ERConfiguration,
): ERConfiguration[] | null {
  const existingIdx = configs.findIndex(c => c.filePath === config.filePath);
  if (existingIdx >= 0) {
    return configs.map((c, i) => (i === existingIdx ? config : c));
  }

  // A data model extracted from a mapping bundle and the same model loaded
  // from its own file must not coexist as two entries.
  if (config.content.kind === 'DataModel') {
    const modelId = normalizeSolutionId(config.content.version.model.id);
    const twinIdx = modelId
      ? configs.findIndex(c =>
          c.content.kind === 'DataModel'
          && normalizeSolutionId(c.content.version.model.id) === modelId,
        )
      : -1;
    if (twinIdx >= 0) {
      if (config.filePath.includes('#datamodel:')) return null;
      return configs.map((c, i) => (i === twinIdx ? config : c));
    }
  }

  const solutionId = normalizeSolutionId(config.solutionVersion.solution.id);
  const byGuidIdx = solutionId
    ? configs.findIndex(c =>
        c.content.kind === config.content.kind
        && normalizeSolutionId(c.solutionVersion.solution.id) === solutionId,
      )
    : -1;
  if (byGuidIdx < 0) return [...configs, config];

  const versionOrder = compareConfigVersions(
    config.solutionVersion.publicVersionNumber,
    configs[byGuidIdx].solutionVersion.publicVersionNumber,
  );
  if (versionOrder < 0) return null;
  // Replace in-place so configIndex references in openTabs stay valid.
  return configs.map((c, i) => (i === byGuidIdx ? config : c));
}
