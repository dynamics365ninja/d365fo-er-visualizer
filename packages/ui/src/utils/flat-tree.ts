/**
 * Flattening a tree into the rows it currently shows.
 *
 * A virtualized tree renders a window of a flat list, so the nesting the DOM
 * used to carry has to live on each row instead: its depth, its parent, and
 * where it sits among its visible siblings (for `aria-level`, `aria-setsize`
 * and `aria-posinset`, which a screen reader can no longer count from the
 * DOM once most siblings are not rendered). Keyboard navigation walks the same
 * list, so ↑ / ↓ reach rows that are not mounted yet.
 */

export interface FlatTreeRow<T> {
  node: T;
  id: string;
  /** 0 for a root. */
  depth: number;
  /** The row this one is nested under; `null` for a root. */
  parentId: string | null;
  /** 1-based position among the siblings that are shown. */
  posInSet: number;
  /** How many siblings (this row included) are shown. */
  setSize: number;
  /** The node has children at all — whether or not any of them is shown. */
  hasChildren: boolean;
  /** The node's children are open (only ever true when it has some). */
  expanded: boolean;
}

export interface FlattenTreeOptions<T, C> {
  getId: (node: T) => string;
  getChildren: (node: T) => readonly T[] | null | undefined;
  /** Whether a node with children shows them. */
  isExpanded: (node: T, context: C, depth: number) => boolean;
  /** A hidden node takes its whole subtree with it. Defaults to shown. */
  isVisible?: (node: T, context: C, depth: number) => boolean;
  /** What a node hands down to its children — e.g. "an ancestor matched the filter". */
  childContext?: (node: T, context: C) => C;
  /** The context the roots see. */
  context?: C;
}

/**
 * The rows of `roots` in display order: each shown node, followed by its
 * shown descendants when it is expanded.
 */
export function flattenVisibleTree<T, C = undefined>(
  roots: readonly T[],
  options: FlattenTreeOptions<T, C>,
): FlatTreeRow<T>[] {
  const { getId, getChildren, isExpanded, isVisible, childContext } = options;
  const rows: FlatTreeRow<T>[] = [];

  const visit = (siblings: readonly T[], depth: number, parentId: string | null, context: C) => {
    const shown = isVisible ? siblings.filter(node => isVisible(node, context, depth)) : siblings;
    shown.forEach((node, i) => {
      const id = getId(node);
      const children = getChildren(node);
      const hasChildren = Boolean(children && children.length > 0);
      const expanded = hasChildren && isExpanded(node, context, depth);
      rows.push({ node, id, depth, parentId, posInSet: i + 1, setSize: shown.length, hasChildren, expanded });
      if (expanded) visit(children!, depth + 1, id, childContext ? childContext(node, context) : context);
    });
  };

  visit(roots, 0, null, options.context as C);
  return rows;
}

/** Row id → index, for jumping from a selection to its row. */
export function indexFlatRows<T>(rows: readonly FlatTreeRow<T>[]): Map<string, number> {
  const index = new Map<string, number>();
  rows.forEach((row, i) => index.set(row.id, i));
  return index;
}

/**
 * A virtualizer's rendered indexes plus rows that must stay mounted wherever
 * the list is scrolled — the row holding the tab stop, so the tree never
 * drops out of the tab order and focus is not lost when that row scrolls
 * away. Sorted, without duplicates or out-of-range indexes.
 */
export function withPinnedIndexes(indexes: readonly number[], pinned: ReadonlyArray<number | null | undefined>, count: number): number[] {
  const extra = pinned.filter((i): i is number => i != null && i >= 0 && i < count && !indexes.includes(i));
  if (extra.length === 0) return indexes as number[];
  return [...new Set([...indexes, ...extra])].sort((a, b) => a - b);
}

/**
 * The row → steps into from an open row: its first shown child, which is the
 * very next row. `undefined` when every child is hidden (a filter, say).
 */
export function firstChildRow<T>(rows: readonly FlatTreeRow<T>[], index: number): FlatTreeRow<T> | undefined {
  const row = rows[index];
  const next = rows[index + 1];
  return row && next && next.parentId === row.id ? next : undefined;
}
