import { describe, expect, it } from 'vitest';
import { treeArrowAction, type TreeArrowRow } from './tree-keyboard';

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

  it('ignores every other key', () => {
    expect(treeArrowAction('ArrowDown', row({}))).toBeNull();
    expect(treeArrowAction('Enter', row({}))).toBeNull();
  });
});
