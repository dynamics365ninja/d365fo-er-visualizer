import { describe, expect, it } from 'vitest';
import { buildFieldTree, pruneFieldTree, type BindingTreeNode } from './mapping-field-tree';

const container = (id: string, items: Array<[string, number, string?]>, extra: Record<string, unknown> = {}) => ({
  id, name: id, items: items.map(([name, type, typeDescriptor]) => ({ name, type, typeDescriptor })), ...extra,
});

// Invoice { Amount, Currency (enum), Lines: list of Line { Item, Qty, Parent: Invoice } }
const model = {
  id: 'M',
  containers: [
    container('Root', [['Invoice', 10, 'Invoice']], { isRoot: true }),
    container('Invoice', [['Amount', 5], ['Currency', 9, 'CurrencyEnum'], ['Lines', 11, 'Line']]),
    container('Line', [['Item', 6], ['Qty', 5], ['Parent', 10, 'Invoice']]),
    container('CurrencyEnum', [['EUR', 0], ['CZK', 0]], { isEnum: true }),
  ],
} as any;

const binding = (path: string, expressionAsString = 'x') => ({ path, expressionAsString });
const bindings = [binding('Invoice/Amount'), binding('invoice/lines'), binding('Invoice/Lines/Item'), binding('Extra/Only')];

const names = (nodes: BindingTreeNode[]): unknown =>
  nodes.map(n => (n.children.length ? { [n.name]: names(n.children) } : n.name));

describe('buildFieldTree with the data model', () => {
  const tree = buildFieldTree(bindings, () => undefined, { model, descriptor: 'Root' });

  it('lists every field, hangs bindings on them case-insensitively and keeps paths the model lacks', () => {
    expect(names(tree)).toEqual([
      { Extra: ['Only'] },
      { Invoice: ['Amount', 'Currency', { Lines: ['Item', 'Parent', 'Qty'] }] },
    ]);
    const invoice = tree[1];
    expect(invoice.children[2].binding).toBe(bindings[1]);
    expect(tree[0].inModel).toBe(false);
  });

  it('does not open enum values or a record already open above it', () => {
    const lines = tree[1].children[2];
    // Line.Parent is the Invoice the path came through.
    expect(lines.children[1].children).toEqual([]);
    expect(tree[1].children[1].children).toEqual([]);
  });

  it('counts bindings and unmapped fields per branch', () => {
    const invoice = tree[1];
    expect(invoice.count).toBe(3);
    // Currency, Lines/Qty and Lines/Parent.
    expect(invoice.unmappedCount).toBe(3);
  });
});

describe('pruneFieldTree', () => {
  const tree = buildFieldTree(bindings, () => undefined, { model, descriptor: 'Root' });

  it('"mapped" keeps the bound paths and their ancestors', () => {
    expect(names(pruneFieldTree(tree, 'mapped'))).toEqual([
      { Extra: ['Only'] },
      { Invoice: ['Amount', { Lines: ['Item'] }] },
    ]);
  });

  it('"unmapped" keeps the fields nothing binds', () => {
    expect(names(pruneFieldTree(tree, 'unmapped'))).toEqual([
      { Invoice: ['Currency', { Lines: ['Parent', 'Qty'] }] },
    ]);
  });

  it('applies the text filter on top of the scope', () => {
    const pruned = pruneFieldTree(tree, 'all', node => node.name.toLowerCase().includes('qty'));
    expect(names(pruned)).toEqual([{ Invoice: [{ Lines: ['Qty'] }] }]);
    expect(pruned[0].unmappedCount).toBe(1);
  });
});
