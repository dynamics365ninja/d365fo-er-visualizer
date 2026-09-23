import { describe, expect, it } from 'vitest';
import { firstChildRow, flattenVisibleTree, indexFlatRows, withPinnedIndexes } from './flat-tree';

interface N { id: string; children?: N[]; hidden?: boolean }

const tree: N[] = [
  {
    id: 'a',
    children: [
      { id: 'a1', children: [{ id: 'a1x' }] },
      { id: 'a2' },
      { id: 'a3', hidden: true, children: [{ id: 'a3x' }] },
    ],
  },
  { id: 'b', children: [] },
  { id: 'c', children: [{ id: 'c1' }] },
];

const base = {
  getId: (n: N) => n.id,
  getChildren: (n: N) => n.children,
};

const ids = (rows: { id: string }[]) => rows.map(r => r.id);

describe('flattenVisibleTree', () => {
  it('lists only the roots when nothing is open', () => {
    const rows = flattenVisibleTree(tree, { ...base, isExpanded: () => false });
    expect(ids(rows)).toEqual(['a', 'b', 'c']);
    expect(rows.every(r => r.depth === 0 && r.parentId === null && !r.expanded)).toBe(true);
  });

  it('puts open children right after their parent, depth first', () => {
    const rows = flattenVisibleTree(tree, { ...base, isExpanded: () => true });
    expect(ids(rows)).toEqual(['a', 'a1', 'a1x', 'a2', 'a3', 'a3x', 'b', 'c', 'c1']);
    const a1x = rows.find(r => r.id === 'a1x')!;
    expect(a1x.depth).toBe(2);
    expect(a1x.parentId).toBe('a1');
  });

  it('opens only the nodes the predicate opens', () => {
    const open = new Set(['a', 'c']);
    const rows = flattenVisibleTree(tree, { ...base, isExpanded: n => open.has(n.id) });
    expect(ids(rows)).toEqual(['a', 'a1', 'a2', 'a3', 'b', 'c', 'c1']);
  });

  it('never marks a childless node expanded', () => {
    const rows = flattenVisibleTree(tree, { ...base, isExpanded: () => true });
    const b = rows.find(r => r.id === 'b')!;
    expect(b.hasChildren).toBe(false);
    expect(b.expanded).toBe(false);
    expect(rows.find(r => r.id === 'a')!.hasChildren).toBe(true);
  });

  it('drops a hidden node together with its subtree and counts only shown siblings', () => {
    const rows = flattenVisibleTree(tree, { ...base, isExpanded: () => true, isVisible: n => !n.hidden });
    expect(ids(rows)).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'c', 'c1']);
    const a1 = rows.find(r => r.id === 'a1')!;
    const a2 = rows.find(r => r.id === 'a2')!;
    expect([a1.posInSet, a1.setSize]).toEqual([1, 2]);
    expect([a2.posInSet, a2.setSize]).toEqual([2, 2]);
    const c = rows.find(r => r.id === 'c')!;
    expect([c.posInSet, c.setSize]).toEqual([3, 3]);
  });

  it('keeps hasChildren when every child is hidden', () => {
    const rows = flattenVisibleTree([{ id: 'p', children: [{ id: 'x', hidden: true }] }], {
      ...base,
      isExpanded: () => true,
      isVisible: n => !n.hidden,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[0].expanded).toBe(true);
  });

  it('hands a context down the tree', () => {
    // Everything below "a1" is shown whatever the filter says.
    const rows = flattenVisibleTree<N, { showAll: boolean }>(tree, {
      ...base,
      isExpanded: () => true,
      isVisible: (n, ctx) => ctx.showAll || !n.id.endsWith('x'),
      childContext: (n, ctx) => ({ showAll: ctx.showAll || n.id === 'a1' }),
      context: { showAll: false },
    });
    expect(ids(rows)).toEqual(['a', 'a1', 'a1x', 'a2', 'a3', 'b', 'c', 'c1']);
  });

  it('passes the depth to the predicates', () => {
    const rows = flattenVisibleTree(tree, { ...base, isExpanded: (_n, _c, depth) => depth < 1 });
    expect(ids(rows)).toEqual(['a', 'a1', 'a2', 'a3', 'b', 'c', 'c1']);
  });
});

describe('indexFlatRows / firstChildRow', () => {
  const rows = flattenVisibleTree(tree, { ...base, isExpanded: n => n.id !== 'a1' });

  it('maps ids to their row index', () => {
    const index = indexFlatRows(rows);
    expect(index.get('a')).toBe(0);
    expect(index.get('c1')).toBe(rows.length - 1);
    expect(index.has('a1x')).toBe(false);
  });

  it('finds the first shown child of an open row', () => {
    expect(firstChildRow(rows, 0)?.id).toBe('a1');
  });

  it('finds nothing under a closed row, a leaf or the last row', () => {
    const index = indexFlatRows(rows);
    expect(firstChildRow(rows, index.get('a1')!)).toBeUndefined();
    expect(firstChildRow(rows, index.get('a2')!)).toBeUndefined();
    expect(firstChildRow(rows, rows.length - 1)).toBeUndefined();
  });
});

describe('withPinnedIndexes', () => {
  it('returns the range untouched when the pinned row is already in it', () => {
    const range = [3, 4, 5];
    expect(withPinnedIndexes(range, [4], 10)).toBe(range);
  });

  it('adds pinned rows outside the range, in order', () => {
    expect(withPinnedIndexes([3, 4, 5], [9, 0], 10)).toEqual([0, 3, 4, 5, 9]);
  });

  it('ignores missing and out-of-range pins', () => {
    expect(withPinnedIndexes([0, 1], [null, undefined, -1, 7], 5)).toEqual([0, 1]);
  });
});
