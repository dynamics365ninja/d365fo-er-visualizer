/**
 * Which model-mapping definition / model root the *currently active* format
 * binds to.
 *
 * A solution often ships one model-mapping (or one data model) that serves
 * several formats — "Free text invoice (Excel)" and "Sales invoice (Excel)"
 * both live next to a mapping that carries one definition per
 * `DataContainerDescriptor`. Marking the "used" definition while the tree is
 * built can only ever answer "used by *some* loaded format", so the explorer
 * froze on whichever format happened to load first. These helpers recompute
 * the answer at render time from the active designer tab instead.
 */
import type { ERConfiguration, ERFormatContent } from '@er-visualizer/core';
import type { TreeNode } from '../state/store.js';

/** `DataContainerDescriptor` names referenced by a format's `model` datasources. */
function collectModelDescriptorNames(datasources: any[], out: Set<string>): void {
  for (const ds of datasources ?? []) {
    const name = ds?.modelInfo?.dataContainerDescriptorName?.trim();
    if (name) out.add(name.toLowerCase());
    if (ds?.children?.length) collectModelDescriptorNames(ds.children, out);
  }
}

/**
 * Descriptor names the configuration at `configIndex` binds to, or `null` when
 * that configuration is not a format (nothing to scope by).
 */
export function getActiveFormatDescriptors(
  configurations: ERConfiguration[],
  configIndex: number | null | undefined,
): Set<string> | null {
  if (configIndex == null) return null;
  const config = configurations[configIndex];
  if (!config || config.content.kind !== 'Format') return null;
  const content = config.content as ERFormatContent;
  const out = new Set<string>();
  collectModelDescriptorNames(content.formatMappingVersion.formatMapping.datasources, out);
  return out.size > 0 ? out : null;
}

/** The descriptor a tree node represents, if it is a candidate for highlighting. */
function candidateDescriptor(node: TreeNode): string | null {
  if (node.type === 'mapping') {
    const descriptor = (node.data?.dataContainerDescriptor ?? '').trim();
    return descriptor ? descriptor.toLowerCase() : null;
  }
  if (node.type === 'container' && node.data?.isRoot === true) {
    const name = (node.name ?? '').trim();
    return name ? name.toLowerCase() : null;
  }
  return null;
}

function collectCandidates(node: TreeNode, out: { node: TreeNode; descriptor: string }[]): void {
  const descriptor = candidateDescriptor(node);
  if (descriptor) out.push({ node, descriptor });
  for (const child of node.children ?? []) collectCandidates(child, out);
}

/**
 * Ids of the tree nodes that belong to the active format: its mapping
 * definitions and the model roots they bind to.
 *
 * Highlighting is per configuration and only kicks in when that configuration
 * offers a choice — a solution with a single mapping definition needs no
 * "this one is active" badge, it would just be noise on every row.
 */
export function collectActiveScopeNodeIds(
  treeNodes: TreeNode[],
  descriptors: Set<string> | null,
): Set<string> {
  const ids = new Set<string>();
  if (!descriptors || descriptors.size === 0) return ids;

  for (const root of treeNodes) {
    const candidates: { node: TreeNode; descriptor: string }[] = [];
    collectCandidates(root, candidates);

    const mappings = candidates.filter(c => c.node.type === 'mapping');
    const containers = candidates.filter(c => c.node.type === 'container');

    for (const group of [mappings, containers]) {
      if (group.length < 2) continue;
      for (const candidate of group) {
        if (descriptors.has(candidate.descriptor)) ids.add(candidate.node.id);
      }
    }
  }

  return ids;
}
