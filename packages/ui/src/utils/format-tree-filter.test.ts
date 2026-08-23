import { describe, it, expect } from 'vitest';
import {
  buildFormatTreeIndex,
  matchFormatElement,
  visibleFormatElementIds,
  type FilterableFormatElement,
} from './format-tree-filter';
import type { NormalizedFormatBinding } from './format-binding-display';

function binding(propertyName: string, expressionAsString: string): NormalizedFormatBinding {
  return {
    propertyName,
    expressionAsString,
    bindingCategory: propertyName === '' ? 'data' : 'visibility',
  } as unknown as NormalizedFormatBinding;
}

/**
 * root
 * ├─ Header (DateTime)                  — type carries "Date", nothing else does
 * │  └─ HeaderChild (String)
 * ├─ InvoiceDate (String)               — name match
 * │  ├─ Line1 (String)
 * │  └─ Line2 (String)
 * │     └─ Leaf (String)
 * └─ VetaA5 (String)                    — matches only through Enabled
 */
const root: FilterableFormatElement = {
  id: 'root',
  name: 'Root',
  elementType: 'Sequence',
  children: [
    {
      id: 'header',
      name: 'Header',
      elementType: 'DateTime',
      children: [{ id: 'header-child', name: 'HeaderChild', elementType: 'String' }],
    },
    {
      id: 'invoice-date',
      name: 'InvoiceDate',
      elementType: 'String',
      children: [
        { id: 'line1', name: 'Line1', elementType: 'String' },
        {
          id: 'line2',
          name: 'Line2',
          elementType: 'String',
          children: [{ id: 'leaf', name: 'Leaf', elementType: 'String' }],
        },
      ],
    },
    { id: 'veta-a5', name: 'VetaA5', elementType: 'String' },
  ],
};

const bindingMap = new Map<string, NormalizedFormatBinding[]>([
  ['header', [binding('', 'model.Header.Number')]],
  ['invoice-date', [binding('', 'model.Invoice.Number')]],
  ['line1', [binding('', 'model.Invoice.Amount')]],
  ['veta-a5', [binding('Enabled', "model.Report.Kind = 'DateOfSupply'")]],
]);

const ids = (set: Set<string>) => [...set].sort();

describe('matchFormatElement', () => {
  it('matches on the element name, case-insensitively', () => {
    expect(matchFormatElement({ id: 'a', name: 'InvoiceDate' }, [], 'date')).toEqual({ reason: 'name' });
  });

  it('matches on any binding expression, including Enabled', () => {
    const enabled = binding('Enabled', "model.Report.Kind = 'DateOfSupply'");
    expect(matchFormatElement({ id: 'a', name: 'VetaA5' }, [enabled], 'date')).toEqual({
      reason: 'binding',
      binding: enabled,
    });
  });

  it('does not match on the element type alone', () => {
    const el = { id: 'a', name: 'Header', elementType: 'DateTime' };
    expect(matchFormatElement(el, [binding('', 'model.Header.Number')], 'date')).toBeNull();
  });

  it('treats an empty needle as a match', () => {
    expect(matchFormatElement({ id: 'a', name: 'Whatever' }, [], '')).toEqual({ reason: 'name' });
  });
});

describe('buildFormatTreeIndex', () => {
  it('flags only elements whose name or formulas contain the term', () => {
    const index = buildFormatTreeIndex(root, bindingMap, 'Date');
    expect(ids(index.selfMatch)).toEqual(['invoice-date', 'veta-a5']);
  });

  it('records why each row matched', () => {
    const index = buildFormatTreeIndex(root, bindingMap, 'Date');
    expect(index.matchReason.get('invoice-date')).toBe('name');
    expect(index.matchReason.get('veta-a5')).toBe('binding');
    expect(index.matchedBinding.get('veta-a5')?.propertyName).toBe('Enabled');
  });

  it('propagates matches up to the ancestors only', () => {
    const index = buildFormatTreeIndex(root, bindingMap, 'Date');
    expect(ids(index.subtreeMatch)).toEqual(['invoice-date', 'root', 'veta-a5']);
    expect(index.subtreeMatch.has('line1')).toBe(false);
    expect(index.subtreeMatch.has('leaf')).toBe(false);
  });

  it('tracks data bindings up the tree', () => {
    const index = buildFormatTreeIndex(root, bindingMap, '');
    expect(index.subtreeBound.has('root')).toBe(true);
    expect(index.subtreeBound.has('invoice-date')).toBe(true);
    expect(index.subtreeBound.has('line2')).toBe(false);
  });

  it('maps every child to its parent', () => {
    const index = buildFormatTreeIndex(root, bindingMap, '');
    expect(index.parentOf.get('leaf')).toBe('line2');
    expect(index.parentOf.get('line2')).toBe('invoice-date');
    expect(index.parentOf.has('root')).toBe(false);
  });
});

describe('visibleFormatElementIds', () => {
  it('shows the matches and the path to them, not the subtree below a match', () => {
    const index = buildFormatTreeIndex(root, bindingMap, 'Date');
    expect(ids(visibleFormatElementIds(root, index, 'Date'))).toEqual([
      'invoice-date',
      'root',
      'veta-a5',
    ]);
  });

  it('keeps the DateTime-typed branch out of the result', () => {
    const index = buildFormatTreeIndex(root, bindingMap, 'Date');
    const visible = visibleFormatElementIds(root, index, 'Date');
    expect(visible.has('header')).toBe(false);
    expect(visible.has('header-child')).toBe(false);
  });

  it('shows the whole tree when the filter is empty', () => {
    const index = buildFormatTreeIndex(root, bindingMap, '');
    expect(visibleFormatElementIds(root, index, '').size).toBe(8);
  });
});
