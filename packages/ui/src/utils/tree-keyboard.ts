const TREE_ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** The keys a tree answers to. */
export function isTreeArrowKey(key: string): boolean {
  return TREE_ARROW_KEYS.has(key);
}

/** What an arrow key does to the focused row of a tree. */
export type TreeArrowAction = 'expand' | 'collapse' | 'firstChild' | 'parent' | 'previous' | 'next';

export interface TreeArrowRow {
  hasChildren: boolean;
  /** The row's children are currently shown. */
  expanded: boolean;
  /** Collapsing would actually hide them — false while a filter keeps the row open. */
  collapsible: boolean;
  hasParent: boolean;
}

/**
 * The WAI-ARIA tree pattern for the arrow keys: ↑ / ↓ move to the previous /
 * next visible row; → opens a closed row and steps into an open one; ← closes
 * an open row and otherwise steps out to the parent, so holding it walks back
 * up the tree folding as it goes.
 */
export function treeArrowAction(key: string, row: TreeArrowRow): TreeArrowAction | null {
  if (key === 'ArrowUp') return 'previous';
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowRight') {
    if (!row.hasChildren) return null;
    return row.expanded ? 'firstChild' : 'expand';
  }
  if (key === 'ArrowLeft') {
    if (row.hasChildren && row.expanded && row.collapsible) return 'collapse';
    return row.hasParent ? 'parent' : null;
  }
  return null;
}

/**
 * The row ↑ / ↓ lands on: the neighbour of `current` among the rows as they
 * are rendered, which already leaves out folded, filtered and hidden ones.
 * Stays put at either end rather than wrapping around.
 */
export function adjacentRow<T>(rows: readonly T[], current: T, direction: 'previous' | 'next'): T | undefined {
  const at = rows.indexOf(current);
  if (at < 0) return undefined;
  return rows[at + (direction === 'next' ? 1 : -1)];
}
