/** What an arrow key does to the focused row of a tree. */
export type TreeArrowAction = 'expand' | 'collapse' | 'firstChild' | 'parent';

export interface TreeArrowRow {
  hasChildren: boolean;
  /** The row's children are currently shown. */
  expanded: boolean;
  /** Collapsing would actually hide them — false while a filter keeps the row open. */
  collapsible: boolean;
  hasParent: boolean;
}

/**
 * The WAI-ARIA tree pattern for ← and →: → opens a closed row and steps into an
 * open one; ← closes an open row and otherwise steps out to the parent, so
 * holding it walks back up the tree folding as it goes.
 */
export function treeArrowAction(key: string, row: TreeArrowRow): TreeArrowAction | null {
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
