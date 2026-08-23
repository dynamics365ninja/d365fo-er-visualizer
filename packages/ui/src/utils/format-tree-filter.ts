import type { NormalizedFormatBinding } from './format-binding-display';

/** Why a format element row matched the active filter. */
export type FormatMatchReason = 'name' | 'binding';

export interface FilterableFormatElement {
  id: string;
  name?: string;
  elementType?: string;
  children?: FilterableFormatElement[];
}

export interface FormatTreeIndex {
  /** Elements that match the filter themselves. */
  selfMatch: Set<string>;
  /** Which field produced the match, for the "why did this row match" hint. */
  matchReason: Map<string, FormatMatchReason>;
  /** The binding that produced a `binding` match — often Enabled/Visible. */
  matchedBinding: Map<string, NormalizedFormatBinding>;
  /** Elements that match, or have a descendant that matches. */
  subtreeMatch: Set<string>;
  /** Elements that carry a data binding, or have a descendant that does. */
  subtreeBound: Set<string>;
  /** child id → parent id, for walking up to the selected element. */
  parentOf: Map<string, string>;
}

export interface FormatElementMatch {
  reason: FormatMatchReason;
  binding?: NormalizedFormatBinding;
}

/**
 * Decides whether a single element matches `needle` (already lower-cased and
 * trimmed): its name, or any of its binding expressions (Value, Enabled,
 * Visible, …).
 *
 * `elementType` is deliberately *not* searched — a query like "Date" otherwise
 * matched every `DateTime` element in the format, none of which carry the term
 * in their name or formulas.
 */
export function matchFormatElement(
  element: FilterableFormatElement,
  bindings: NormalizedFormatBinding[],
  needle: string,
): FormatElementMatch | null {
  if (!needle) return { reason: 'name' };
  if (element.name?.toLowerCase().includes(needle)) return { reason: 'name' };
  const binding = bindings.find(b => b.expressionAsString?.toLowerCase().includes(needle));
  return binding ? { reason: 'binding', binding } : null;
}

export function buildFormatTreeIndex(
  rootElement: FilterableFormatElement,
  bindingMap: Map<string, NormalizedFormatBinding[]>,
  filter: string,
): FormatTreeIndex {
  const needle = filter.trim().toLowerCase();
  const selfMatch = new Set<string>();
  const matchReason = new Map<string, FormatMatchReason>();
  const matchedBinding = new Map<string, NormalizedFormatBinding>();
  const subtreeMatch = new Set<string>();
  const subtreeBound = new Set<string>();
  const parentOf = new Map<string, string>();

  const walk = (el: FilterableFormatElement, parentId?: string): void => {
    if (parentId) parentOf.set(el.id, parentId);
    const bs = bindingMap.get(el.id) ?? [];
    const match = matchFormatElement(el, bs, needle);
    if (match) {
      selfMatch.add(el.id);
      matchReason.set(el.id, match.reason);
      if (match.binding) matchedBinding.set(el.id, match.binding);
    }
    const isBound = bs.some(b => b.bindingCategory === 'data');

    let childMatch = false;
    let childBound = false;
    for (const child of el.children ?? []) {
      walk(child, el.id);
      if (subtreeMatch.has(child.id)) childMatch = true;
      if (subtreeBound.has(child.id)) childBound = true;
    }
    if (match || childMatch) subtreeMatch.add(el.id);
    if (isBound || childBound) subtreeBound.add(el.id);
  };
  walk(rootElement);

  return { selfMatch, matchReason, matchedBinding, subtreeMatch, subtreeBound, parentOf };
}

/**
 * Rows the tree renders for a filter, before any manual expansion: the matches
 * plus the ancestors needed to reach them. Descendants of a match are *not*
 * included — they only appear when the user opens the row.
 */
export function visibleFormatElementIds(
  rootElement: FilterableFormatElement,
  index: FormatTreeIndex,
  filter: string,
): Set<string> {
  const visible = new Set<string>();
  if (!filter.trim()) {
    const all = (el: FilterableFormatElement): void => {
      visible.add(el.id);
      for (const child of el.children ?? []) all(child);
    };
    all(rootElement);
    return visible;
  }
  const walk = (el: FilterableFormatElement): void => {
    if (!index.subtreeMatch.has(el.id)) return;
    visible.add(el.id);
    // Children of a match stay hidden unless they are on a path to another match.
    for (const child of el.children ?? []) walk(child);
  };
  walk(rootElement);
  return visible;
}
