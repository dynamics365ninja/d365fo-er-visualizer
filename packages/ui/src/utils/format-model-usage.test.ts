import { describe, it, expect } from 'vitest';
import type { ERBinding, ERDataModel, ERFormatBinding, ERFormatElement } from '@er-visualizer/core';
import { buildFormatBindingPresentation } from './format-binding-display';
import {
  buildModelUsageTree,
  countModelUsageIntents,
  extractModelPaths,
  filterModelUsageTree,
  type ModelUsageNode,
} from './format-model-usage';

const MODEL = new Set(['model']);

describe('extractModelPaths', () => {
  it('reads plain and quoted model paths', () => {
    expect(extractModelPaths('model.InvoiceBase.CompanyInfo.Name', MODEL)).toEqual([['InvoiceBase', 'CompanyInfo', 'Name']]);
    expect(extractModelPaths("model.'Invoice lines'.Amount", MODEL)).toEqual([['Invoice lines', 'Amount']]);
  });

  it('finds every path inside a formula, each once', () => {
    expect(extractModelPaths('IF(model.Inv.Amount > 0, model.Inv.Currency, model.Inv.Amount)', MODEL)).toEqual([
      ['Inv', 'Amount'],
      ['Inv', 'Currency'],
    ]);
  });

  it('ignores other datasources, string literals and labels', () => {
    expect(extractModelPaths('Enums.AxNoYes.Yes', MODEL)).toEqual([]);
    expect(extractModelPaths('CONCATENATE("model.Fake", @"GER_LABEL:model", @GER_LABEL:Other, model.Real)', MODEL)).toEqual([['Real']]);
    expect(extractModelPaths('model', MODEL)).toEqual([]);
  });

  it('matches the datasource name regardless of case', () => {
    expect(extractModelPaths('Model.Lines.Qty', MODEL)).toEqual([['Lines', 'Qty']]);
  });

  it('resolves @ against the enclosing record list', () => {
    expect(extractModelPaths('@.Qty * @.Price', MODEL, ['Lines'])).toEqual([['Lines', 'Qty'], ['Lines', 'Price']]);
    expect(extractModelPaths('@.Qty', MODEL)).toEqual([]);
  });

  it('stops before a calculated field the format hangs under a model node', () => {
    expect(extractModelPaths("model.InvoiceBase.'$Split_Note'.Value", MODEL)).toEqual([['InvoiceBase']]);
    expect(extractModelPaths('model.$Totals.Amount', MODEL)).toEqual([]);
  });
});

function element(id: string, name: string, elementType: string, children: ERFormatElement[] = []): ERFormatElement {
  return { id, name, elementType, children, attributes: {} } as unknown as ERFormatElement;
}

function binding(componentId: string, expressionAsString: string, propertyName = ''): ERFormatBinding {
  return { componentId, expressionAsString, propertyName } as unknown as ERFormatBinding;
}

// File ─┬─ Company (cell)          ← model.Header.Company.Name
//       ├─ Lines (range)           ← model.Lines
//       │    ├─ Qty (cell)         ← @.Qty
//       │    └─ Total (cell)       ← @.Qty * model.Header.Rate
//       └─ Note (cell)             ← model.Header.Note, Enabled ← model.Header.ShowNote
const root = element('root', 'File', 'ExcelFile', [
  element('company', 'Company', 'ExcelCell'),
  element('lines', 'Lines', 'ExcelRange', [element('qty', 'Qty', 'ExcelCell'), element('total', 'Total', 'ExcelCell')]),
  element('note', 'Note', 'ExcelCell'),
]);

const { groups } = buildFormatBindingPresentation(root, [
  binding('company', 'model.Header.Company.Name'),
  binding('lines', 'model.Lines'),
  binding('qty', '@.Qty'),
  binding('total', '@.Qty * model.Header.Rate'),
  binding('note', 'model.Header.Note'),
  binding('note', 'model.Header.ShowNote', 'Enabled'),
]);

const mappingBindings = [
  { path: 'Header/Company/Name', expressionAsString: "'$Company'.Name" },
  { path: 'Lines', expressionAsString: "'$Lines'" },
  { path: 'Lines/Qty', expressionAsString: "'$Lines'.Qty" },
  { path: 'Header/Rate', expressionAsString: "'$Params'.Rate" },
  { path: 'Header/ShowNote', expressionAsString: 'true' },
] as ERBinding[];

const byPath = (nodes: readonly ModelUsageNode[]): Record<string, ModelUsageNode> => {
  const out: Record<string, ModelUsageNode> = {};
  const walk = (node: ModelUsageNode) => { out[node.path] = node; node.children.forEach(walk); };
  nodes.forEach(walk);
  return out;
};

const outline = (nodes: readonly ModelUsageNode[]): unknown[] =>
  nodes.map(node => (node.children.length ? { [node.name]: outline(node.children) } : node.name));

describe('buildModelUsageTree', () => {
  const tree = buildModelUsageTree({ rootElement: root, groups, modelNames: MODEL, mappingBindings });
  const nodes = byPath(tree);

  it('nests the paths the format reads in the order it first reaches them', () => {
    expect(outline(tree)).toEqual([
      { Header: [{ Company: ['Name'] }, 'Rate', 'Note', 'ShowNote'] },
      { Lines: ['Qty'] },
    ]);
  });

  it('resolves @ paths against the range bound to the list', () => {
    expect(nodes['Lines/Qty'].usages.map(u => u.group.elementName)).toEqual(['Qty', 'Total']);
  });

  it('links each path to the mapping binding that fills it', () => {
    expect(nodes['Header/Company/Name'].mapping?.expressionAsString).toBe("'$Company'.Name");
    expect(nodes['Lines'].mapping?.expressionAsString).toBe("'$Lines'");
  });

  it('flags a field the format reads but the mapping never fills', () => {
    expect(nodes['Header/Note'].unmapped).toBe(true);
    expect(nodes['Header/Rate'].unmapped).toBe(false);
    // A record that is only a step on the way to its fields needs no binding.
    expect(nodes['Header'].unmapped).toBe(false);
    expect(tree.reduce((n, node) => n + node.unmappedCount, 0)).toBe(1);
  });

  it('counts usages and read fields per branch', () => {
    expect(nodes['Header'].usageCount).toBe(4);
    expect(nodes['Header'].fieldCount).toBe(4);
    expect(nodes['Lines'].usageCount).toBe(3);
  });

  it('keeps the intent of every usage', () => {
    expect(nodes['Header/ShowNote'].usages[0].intent).toBe('condition');
    expect(nodes['Header/Rate'].usages[0].intent).toBe('calculated');
  });

  it('flags nothing without a loaded mapping', () => {
    const unmappedTree = buildModelUsageTree({ rootElement: root, groups, modelNames: MODEL, mappingBindings: null });
    expect(unmappedTree.reduce((n, node) => n + node.unmappedCount, 0)).toBe(0);
  });

  it('attaches model fields and trusts their type over the tree shape', () => {
    const model = {
      containers: [
        { id: 'Root', name: 'Root', isRoot: true, items: [{ name: 'Header', type: 10, typeDescriptor: 'Header' }, { name: 'Lines', type: 11, typeDescriptor: 'Line' }] },
        { id: 'Header', name: 'Header', items: [{ name: 'Company', type: 10, typeDescriptor: 'Company' }, { name: 'Note', type: 6, label: '@GER_LABEL:Note' }] },
        { id: 'Company', name: 'Company', items: [{ name: 'Name', type: 6 }] },
        { id: 'Line', name: 'Line', items: [{ name: 'Qty', type: 5 }] },
      ],
    } as unknown as ERDataModel;
    const withModel = byPath(buildModelUsageTree({
      rootElement: root,
      groups,
      modelNames: MODEL,
      mappingBindings: mappingBindings.filter(b => b.path !== 'Lines'),
      dataModel: { model, descriptor: 'Root' },
    }));
    expect(withModel['Header/Note'].field?.label).toBe('@GER_LABEL:Note');
    // A record list with fields below it still needs its own binding.
    expect(withModel['Lines'].field?.type).toBe(11);
    expect(withModel['Lines'].unmapped).toBe(true);
    expect(withModel['Header/Rate'].field).toBeUndefined();
  });
});

describe('filterModelUsageTree', () => {
  const tree = buildModelUsageTree({ rootElement: root, groups, modelNames: MODEL, mappingBindings });

  it('drops usages of switched-off intents, and the paths left with none', () => {
    const filtered = filterModelUsageTree(tree, { keepUsage: u => u.intent === 'condition' });
    expect(outline(filtered)).toEqual([{ Header: ['ShowNote'] }]);
    expect(filtered[0].usageCount).toBe(1);
  });

  it('keeps a matching node with its subtree and the branches leading to it', () => {
    const filtered = filterModelUsageTree(tree, { matchNode: node => node.name === 'Company' });
    expect(outline(filtered)).toEqual([{ Header: [{ Company: ['Name'] }] }]);
  });

  it('shows only the unmapped paths when asked', () => {
    const filtered = filterModelUsageTree(tree, { onlyUnmapped: true });
    expect(outline(filtered)).toEqual([{ Header: ['Note'] }]);
    expect(filtered[0].usages).toEqual([]);
  });
});

describe('countModelUsageIntents', () => {
  it('counts a binding once even when it reads several paths', () => {
    const tree = buildModelUsageTree({ rootElement: root, groups, modelNames: MODEL, mappingBindings });
    expect(countModelUsageIntents(tree)).toEqual({ direct: 4, calculated: 1, condition: 1, text: 0, property: 0 });
  });
});
