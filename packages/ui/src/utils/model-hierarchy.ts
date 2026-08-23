import type { ERConfiguration, ERModelMappingContent, ERFormatContent, ERDataModelContent } from '@er-visualizer/core';

// ─── Model hierarchy helpers ─────────────────────────────────────────────────

/** Normalize a solution GUID to lowercase without surrounding curly braces. */
export function normGuid(g: string | undefined): string {
  return (g ?? '').replace(/^\{|\}$/g, '').toLowerCase();
}

/**
 * Returns the best version string to display for a configuration.
 * Priority:
 *  1. publicVersionNumber from the ERSolutionVersion envelope (set by
 *     `injectNameHint` to the listing version, e.g. 386 for a mapping).
 *     This beats the inner `ERModelMappingVersion.Number` which can be a
 *     descriptor-level sub-version (often 1) rather than the public version.
 *  2. ModelMapping: internal version.number from the XML body (present when
 *     the XML carries a real `ERSolutionVersion` envelope, e.g. offline files).
 *  3. solutionVersion.number  (integer attribute, always present as last resort)
 */
export function getBestVersion(cfg: ERConfiguration | undefined): string | undefined {
  if (!cfg) return undefined;
  if (cfg.solutionVersion.publicVersionNumber) return cfg.solutionVersion.publicVersionNumber;
  if (cfg.content.kind === 'ModelMapping') {
    const num = (cfg.content as ERModelMappingContent).version.number;
    if (num > 0) return String(num);
  }
  if (cfg.solutionVersion.number > 0) return String(cfg.solutionVersion.number);
  return undefined;
}

/**
 * Every DataModel GUID a format points at: the embedded ModelMappingVersion
 * (export bundles) and the `model` datasource's `ModelGuid` (the common case
 * for formats exported on their own).
 */
export function formatReferencedModelIds(content: ERFormatContent): string[] {
  const ids: string[] = [];
  for (const embedded of content.embeddedModelMappingVersions ?? []) {
    const id = normGuid(embedded.mapping?.modelId);
    if (id && !ids.includes(id)) ids.push(id);
  }
  const datasources = content.formatMappingVersion?.formatMapping?.datasources ?? [];
  for (const ds of datasources) {
    const id = normGuid(ds.modelInfo?.modelGuid);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface ExplorerModelGroup {
  configIdx: number;
  /** Direct non-DataModel children (mappings / formats). */
  children: number[];
  /** Derived DataModel children. */
  subModels: ExplorerModelGroup[];
}

/**
 * Build a model-centric hierarchy from the loaded configurations.
 * Each DataModel acts as a container for its derived models (via the
 * solution-level `Base=` derivation) and for the ModelMappings / Formats
 * that target it. Note two distinct GUIDs are in play here:
 *  - `solutionVersion.solution.id` is the *solution wrapper* GUID (used only
 *    to resolve `Base=` derivation between configs of the same kind).
 *  - `content.version.model.id` is the DataModel *component*'s own GUID —
 *    this is what `ModelMapping.mapping.modelId` (and, transitively, a
 *    Format's embedded ModelMapping `modelId`) actually reference.
 * Mixing these up is why mappings/formats used to end up "unlinked" even
 * when their target model was loaded.
 * Returns root model groups + orphaned non-DataModel indices that
 * have no matching parent model in the loaded set.
 */
export function buildExplorerModelGroups(
  configurations: ERConfiguration[],
): { roots: ExplorerModelGroup[]; orphans: number[] } {
  // DataModel component GUID (`<ERDataModel ID.=>`) → config index.
  const modelIdToIdx = new Map<string, number>();
  // Solution-wrapper GUID → config index, used only for `Base=` derivation.
  const solutionIdToIdx = new Map<string, number>();

  configurations.forEach((cfg, idx) => {
    const solutionId = normGuid(cfg.solutionVersion.solution.id);
    if (solutionId) solutionIdToIdx.set(solutionId, idx);
    if (cfg.content.kind === 'DataModel') {
      const modelId = normGuid((cfg.content as ERDataModelContent).version.model.id);
      if (modelId) modelIdToIdx.set(modelId, idx);
    }
  });

  /** Resolves the DataModel a given config belongs to, or undefined if none is loaded. */
  const resolveParentModelIdx = (cfg: ERConfiguration): number | undefined => {
    if (cfg.content.kind === 'ModelMapping') {
      const modelId = normGuid((cfg.content as ERModelMappingContent).version.mapping.modelId);
      return modelId ? modelIdToIdx.get(modelId) : undefined;
    }
    if (cfg.content.kind === 'Format') {
      for (const modelId of formatReferencedModelIds(cfg.content as ERFormatContent)) {
        const idx = modelIdToIdx.get(modelId);
        if (idx != null) return idx;
      }
      return undefined;
    }
    // DataModel → DataModel derivation uses the solution-level `Base=` reference.
    const parentSolutionId = normGuid(cfg.solutionVersion.solution.baseSolutionId);
    const parentIdx = parentSolutionId ? solutionIdToIdx.get(parentSolutionId) : undefined;
    return parentIdx != null && configurations[parentIdx].content.kind === 'DataModel' ? parentIdx : undefined;
  };

  const childrenOf = new Map<number, number[]>();   // modelIdx → non-DM children
  const subModelsOf = new Map<number, number[]>();  // modelIdx → derived DM children
  const orphans: number[] = [];

  configurations.forEach((cfg, idx) => {
    const parentIdx = resolveParentModelIdx(cfg);
    if (cfg.content.kind === 'DataModel') {
      if (parentIdx != null) {
        if (!subModelsOf.has(parentIdx)) subModelsOf.set(parentIdx, []);
        subModelsOf.get(parentIdx)!.push(idx);
      }
      return;
    }
    if (parentIdx != null) {
      if (!childrenOf.has(parentIdx)) childrenOf.set(parentIdx, []);
      childrenOf.get(parentIdx)!.push(idx);
    } else {
      orphans.push(idx);
    }
  });

  const buildGroup = (modelIdx: number, visited: Set<number>): ExplorerModelGroup => {
    visited.add(modelIdx);
    return {
      configIdx: modelIdx,
      children: childrenOf.get(modelIdx) ?? [],
      subModels: (subModelsOf.get(modelIdx) ?? [])
        .filter(idx => !visited.has(idx))
        .map(idx => buildGroup(idx, visited)),
    };
  };

  const rootModelIdxs = configurations
    .map((cfg, idx) => ({ cfg, idx }))
    .filter(({ cfg }) => cfg.content.kind === 'DataModel')
    .filter(({ cfg }) => resolveParentModelIdx(cfg) == null)
    .map(({ idx }) => idx);

  return {
    roots: rootModelIdxs.map(idx => buildGroup(idx, new Set())),
    orphans,
  };
}

