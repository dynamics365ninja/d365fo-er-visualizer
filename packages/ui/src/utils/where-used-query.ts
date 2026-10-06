import type { WhereUsedTarget } from './impact-index';
/**
 * What "Where used" searches for when started from a node — a datasource,
 * a model field or record, an enum. `null` for nodes it does not apply to
 * (format elements, bindings, whole configurations).
 */
export function whereUsedQueryFor(node: { type?: string; name?: string; data?: { name?: string } } | null | undefined): string | null {
  if (!node) return null;
  switch (node.type) {
    case 'datasource':
      return node.data?.name ?? node.name ?? null;
    case 'field':
    case 'container':
    case 'enum':
      return node.name ?? null;
    default:
      return null;
  }
}

/**
 * The exact item a where-used started from a node is about: a model field of
 * one record, a datasource of one definition. The query text alone would also
 * match every same-named field of other records.
 */
export function whereUsedTargetFor(node: { type?: string; name?: string; configIndex?: number; ownerName?: string; data?: { name?: string; parentPath?: string } } | null | undefined): WhereUsedTarget | null {
  if (!node) return null;
  if (node.type === 'field' && node.ownerName && node.name) {
    return { kind: 'modelField', container: node.ownerName, field: node.name };
  }
  if (node.type === 'datasource' && node.configIndex != null && node.data?.name) {
    return { kind: 'datasource', configIndex: node.configIndex, name: node.data.name, parentPath: node.data.parentPath };
  }
  return null;
}
