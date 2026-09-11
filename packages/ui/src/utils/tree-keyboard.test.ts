import { describe, expect, it } from 'vitest';
import { adjacentRow, treeArrowAction, type TreeArrowRow } from './tree-keyboard';

const row = (partial: Partial<TreeArrowRow>): TreeArrowRow => ({
  hasChildren: true,
  expanded: false,
  collapsible: true,
  hasParent: true,
  ...partial,
});

describe('treeArrowAction', () => {
  it('→ opens a closed row, then steps into it', () => {
    expect(treeArrowAction('ArrowRight', row({ expanded: false }))).toBe('expand');
    expect(treeArrowAction('ArrowRight', row({ expanded: true }))).toBe('firstChild');
  });

  it('→ does nothing on a leaf', () => {
    expect(treeArrowAction('ArrowRight', row({ hasChildren: false }))).toBeNull();
  });

  it('← closes an open row', () => {
    expect(treeArrowAction('ArrowLeft', row({ expanded: true }))).toBe('collapse');
  });

  it('← steps out to the parent from a closed row or a leaf', () => {
    expect(treeArrowAction('ArrowLeft', row({ expanded: false }))).toBe('parent');
    expect(treeArrowAction('ArrowLeft', row({ hasChildren: false }))).toBe('parent');
  });

  it('← steps out when a filter keeps the row open', () => {
    expect(treeArrowAction('ArrowLeft', row({ expanded: true, collapsible: false }))).toBe('parent');
  });

  it('← does nothing on a closed root', () => {
    expect(treeArrowAction('ArrowLeft', row({ hasParent: false }))).toBeNull();
  });

  it('↑ / ↓ move between rows whatever the row is', () => {
    expect(treeArrowAction('ArrowUp', row({}))).toBe('previous');
    expect(treeArrowAction('ArrowDown', row({ hasChildren: false, hasParent: false }))).toBe('next');
  });

  it('ignores every other key', () => {
    expect(treeArrowAction('Enter', row({}))).toBeNull();
    expect(treeArrowAction('Home', row({}))).toBeNull();
  });
});

describe('adjacentRow', () => {
  const rows = ['root', 'a', 'b'];

  it('returns the neighbour in render order', () => {
    expect(adjacentRow(rows, 'a', 'previous')).toBe('root');
    expect(adjacentRow(rows, 'a', 'next')).toBe('b');
  });

  it('stays put at either end', () => {
    expect(adjacentRow(rows, 'root', 'previous')).toBeUndefined();
    expect(adjacentRow(rows, 'b', 'next')).toBeUndefined();
  });

  it('returns nothing for a row that is not in the list', () => {
    expect(adjacentRow(rows, 'gone', 'next')).toBeUndefined();
  });
});
