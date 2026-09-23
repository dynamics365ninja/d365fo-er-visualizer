/**
 * Small helpers shared by the ingest pipeline and the F&O connector panel.
 */

import type { ErConfigSummary } from '@er-visualizer/fno-client';

export const ZERO_GUID_LOWER = '00000000-0000-0000-0000-000000000000';

/** True when `guid` is a non-empty, non-zero GUID — i.e. usable as a download parameter. */
export function isUsableGuid(guid: string | undefined): boolean {
  if (!guid) return false;
  return guid.replace(/^\{|\}$/g, '').toLowerCase() !== ZERO_GUID_LOWER;
}

/**
 * Descriptor candidates for `GetModelMappingByID`, root containers first.
 *
 * Every `ERDataModel.containers[].name` is a legal `_dataContainerDescriptorName`,
 * but only *root* containers can carry a mapping definition. A large model has
 * a few dozen roots among a couple of hundred containers, so ordering them
 * first is what keeps the sibling-definition probes inside their budget.
 */
export function descriptorNamesFromContainers(
  containers: { name?: string; isRoot?: boolean }[] | undefined,
): string[] {
  const roots: string[] = [];
  const rest: string[] = [];
  for (const c of containers ?? []) {
    const name = (c?.name ?? '').trim();
    if (!name) continue;
    (c?.isRoot ? roots : rest).push(name);
  }
  return Array.from(new Set([...roots, ...rest]));
}

export function componentKey(c: ErConfigSummary): string {
  return `${c.solutionName}::${c.configurationName}::${c.componentType}::${c.version ?? ''}`;
}
