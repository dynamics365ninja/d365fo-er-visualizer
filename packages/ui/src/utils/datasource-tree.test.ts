import { describe, expect, it } from 'vitest';
import type { ERDataModel, ERDatasource } from '@er-visualizer/core';
import {
  ancestorPathKeys,
  buildDatasourceTree,
  countDeclaredDatasources,
  datasourcePathKey,
  filterDatasources,
  findModelForDescriptor,
  keysWithDeclaredDescendants,
  type DatasourceTreeNode,
} from './datasource-tree';

const ds = (name: string, parentPath: string | undefined, extra: Partial<ERDatasource> = {}, children: ERDatasource[] = []): ERDatasource => ({
  name,
  parentPath,
  type: 'CalculatedField',
  children,
  ...extra,
});

// The shape the parser produces for a Sales invoice format: two calculated
// fields named `$Split_Note` under different model records.
const datasources: ERDatasource[] = [
  ds('model', undefined, { type: 'DataModel', modelInfo: { dataContainerDescriptorName: 'SalesInvoice' } }, [
    ds('InvoiceLines', 'model', { type: 'Container', implicit: true }, [
      ds('$Split_InventDimPrint', 'model/InvoiceLines'),
      ds('LineBase', 'model/InvoiceLines', { type: 'Container', implicit: true }, [
        ds('$Split_Note', 'model/InvoiceLines/LineBase'),
      ]),
    ]),
    ds('InvoiceBase', 'model', { type: 'Container', implicit: true }, [
      ds('$Split_Note', 'model/InvoiceBase'),
    ]),
  ]),
  ds('Enums', undefined, { type: 'Container' }, [
    ds('$Unit', 'Enums', { type: 'Enum', enumInfo: { enumName: 'UnitOfMeasure', isModelEnum: false, sourceKind: 'Ax' } }),
  ]),
];

const model: ERDataModel = {
  id: '{MODEL}',
  name: 'Invoice model',
  containers: [
    { id: 'SalesInvoice', name: 'SalesInvoice', isRoot: true, items: [
      { name: 'InvoiceBase', type: 10, typeDescriptor: 'InvoiceBase' },
      { name: 'InvoiceLines', type: 11, typeDescriptor: 'Line' },
      { name: 'Currency', type: 6 },
    ] },
    { id: 'InvoiceBase', name: 'InvoiceBase', items: [{ name: 'InvoiceId', type: 6 }] },
    { id: 'Line', name: 'Line', items: [
      { name: 'Amount', type: 5 },
      { name: 'LineBase', type: 10, typeDescriptor: 'LineBase' },
      { name: 'Status', type: 9, typeDescriptor: 'StatusEnum' },
    ] },
    { id: 'LineBase', name: 'LineBase', items: [{ name: 'ItemId', type: 6 }] },
    { id: 'StatusEnum', name: 'StatusEnum', isEnum: true, items: [{ name: 'Open', type: 0 }] },
  ],
};

const names = (nodes: DatasourceTreeNode[]) => nodes.map(node => node.name);

describe('datasource tree', () => {
  it('keys a path case-insensitively without name decorations', () => {
    expect(datasourcePathKey('model/InvoiceLines/LineBase', '$Split_Note')).toBe('model/invoicelines/linebase/split_note');
    expect(datasourcePathKey(undefined, '#Annex')).toBe('annex');
    expect(ancestorPathKeys('model/invoicelines/linebase')).toEqual(['model', 'model/invoicelines']);
  });

  it('counts declared datasources at every depth, not the implicit path nodes', () => {
    expect(countDeclaredDatasources(datasources)).toBe(6);
  });

  it('shows the declared nesting when the data model is not loaded', () => {
    const tree = buildDatasourceTree(datasources);
    const [modelNode] = tree.roots;
    expect(modelNode.declaredCount).toBe(3);
    const [lines, base] = tree.childrenOf(modelNode);
    expect(names([lines, base])).toEqual(['InvoiceLines', 'InvoiceBase']);
    expect(lines.key).toBe('model/invoicelines');
    const [split, lineBase] = tree.childrenOf(lines);
    expect(names([split, lineBase])).toEqual(['$Split_InventDimPrint', 'LineBase']);
    expect(tree.childrenOf(lineBase)[0].key).toBe(datasourcePathKey('model/InvoiceLines/LineBase', '$Split_Note'));
  });

  it('lays the model structure under the model datasource, calculated fields first', () => {
    const tree = buildDatasourceTree(datasources, source =>
      source.modelInfo ? { model, descriptor: source.modelInfo.dataContainerDescriptorName } : null,
    );
    const [modelNode, enums] = tree.roots;

    const top = tree.childrenOf(modelNode);
    expect(names(top)).toEqual(['InvoiceBase', 'InvoiceLines', 'Currency']);
    // The implicit record and the model field are one node.
    expect(top[1].datasource?.implicit).toBe(true);
    expect(top[1].field?.type).toBe(11);
    expect(top[2].datasource).toBeUndefined();

    const lines = tree.childrenOf(top[1]);
    expect(names(lines)).toEqual(['$Split_InventDimPrint', 'Amount', 'LineBase', 'Status']);
    expect(tree.hasChildren(lines[2])).toBe(true);
    // An enum field names a container too, but has no fields to browse.
    expect(tree.hasChildren(lines[3])).toBe(false);
    expect(names(tree.childrenOf(lines[2]))).toEqual(['$Split_Note', 'ItemId']);

    // Children of anything that is not a data model stay as declared.
    expect(names(tree.childrenOf(enums))).toEqual(['$Unit']);
    expect(tree.childrenOf(top[1])).toBe(lines);
  });

  it('filters at any depth and keeps the path to each match', () => {
    const filter = filterDatasources(datasources, 'split_note')!;
    expect([...filter.matched]).toEqual(['model/invoicelines/linebase/split_note', 'model/invoicebase/split_note']);
    expect([...filter.ancestors]).toEqual(['model', 'model/invoicelines', 'model/invoicelines/linebase', 'model/invoicebase']);
    expect([...filterDatasources(datasources, 'unitofmeasure')!.matched]).toEqual(['enums/unit']);
    expect(filterDatasources(datasources, '  ')).toBeNull();
  });

  it('opens every path that leads to a declared datasource', () => {
    expect([...keysWithDeclaredDescendants(datasources)]).toEqual([
      'model', 'model/invoicelines', 'model/invoicelines/linebase', 'model/invoicebase', 'enums',
    ]);
  });

  it('finds the model holding a descriptor, preferring the referenced one', () => {
    const other: ERDataModel = { ...model, id: '{OTHER}' };
    expect(findModelForDescriptor([other, model], 'salesinvoice', new Set(['model']))).toBe(model);
    expect(findModelForDescriptor([other, model], 'SalesInvoice')).toBe(other);
    expect(findModelForDescriptor([model], 'Missing')).toBeUndefined();
  });
});
