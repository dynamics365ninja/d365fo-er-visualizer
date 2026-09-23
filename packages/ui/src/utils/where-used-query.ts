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
