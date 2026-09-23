import { describe, expect, it } from 'vitest';
import { buildBindingTree } from './ModelMappingDesigner';

const binding = (path: string) => ({ path, expressionAsString: 'x' });

describe('model mapping binding tree', () => {
  // The F&O designer lists the model alphabetically; the XML order means nothing.
  it('sorts every level by name', () => {
    const tree = buildBindingTree([
      binding('Invoice/Lines/Quantity'),
      binding('Company/Name'),
      binding('Invoice/Amount'),
      binding('Invoice/Lines/Item10'),
      binding('Invoice/Lines/item2'),
    ]);
    expect(tree.map(n => n.name)).toEqual(['Company', 'Invoice']);
    const invoice = tree[1];
    expect(invoice.children.map(n => n.name)).toEqual(['Amount', 'Lines']);
    expect(invoice.children[1].children.map(n => n.name)).toEqual(['item2', 'Item10', 'Quantity']);
    expect(invoice.count).toBe(4);
  });

  it('carries the model field label of every level', () => {
    const labels: Record<string, string> = { Invoice: 'Faktura', 'Invoice/Amount': 'Částka' };
    const tree = buildBindingTree([binding('Invoice/Amount')], path => labels[path]);
    expect(tree[0].label).toBe('Faktura');
    expect(tree[0].children[0].label).toBe('Částka');
  });
});
