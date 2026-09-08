/** Sectioning for the where-used panel.
 *
 * The panel's scope toggle splits mapping from format, but "mapping" lumps
 * plain bindings together with calculated fields, user parameters, group-by
 * aggregations and validations — quite different reasons for a hit. Grouping
 * them the way the search panel groups its hits lets both lists share one
 * colour language, so a green row means "binding" in either panel.
 */
export type ReferenceCategory = 'bindings' | 'expressions' | 'structure';

export const WHERE_USED_CATEGORY_ORDER: ReferenceCategory[] = ['bindings', 'expressions', 'structure'];

export function referenceCategory(ref: {
  kind: 'binding' | 'formatElement';
  kindLabel: string;
}): ReferenceCategory {
  if (ref.kind === 'formatElement') return 'structure';
  const kind = ref.kindLabel.trim().toLowerCase();
  // The scan emits a bare "binding" (or "binding <qualifier>") for mapping
  // bindings and a terse code — calc, param, agg, validation, message — for
  // everything expression-shaped.
  return kind === 'binding' || kind.startsWith('binding ') ? 'bindings' : 'expressions';
}
