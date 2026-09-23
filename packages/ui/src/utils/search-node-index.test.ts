import { describe, expect, it } from 'vitest';
import { ERComponentKind, GUIDRegistry } from '@er-visualizer/core';
import type { TreeNode } from '../state/store';
import { buildSearchNodeIndex, findNodeForSearchResult, type SearchResultEntry } from './search-node-index';

function node(id: string, type: TreeNode['type'], name: string, extra: Partial<TreeNode> = {}): TreeNode {
  return { id, name, icon: '', type, configIndex: 0, ...extra };
}

const bindingA = node('cfg-0-b-a', 'binding', 'Total', { data: { path: 'Invoice.Total' }, mappingDefinition: 'A' });
const bindingB = node('cfg-0-b-b', 'binding', 'Total', { data: { path: 'Invoice.Total' }, mappingDefinition: 'B' });
const field = node('cfg-0-field', 'field', 'Amount');
const otherField = node('cfg-0-field-2', 'field', 'Amount');
const root = node('cfg-0', 'file', 'Mapping', {
  data: { kind: 'ModelMapping' },
  children: [
    node('cfg-0-sec', 'section', 'Bindings', { children: [bindingA, bindingB] }),
    node('cfg-0-c1', 'container', 'Header', { children: [otherField] }),
    node('cfg-0-c2', 'container', 'Lines', { children: [field] }),
  ],
});

// Not a real mapping, so no definition is preferred unless the hit names one.
const configurations = [{ filePath: 'mapping.xml', content: { kind: 'DataModel' } }];
const registry = { lookup: () => undefined };

function hit(overrides: Partial<SearchResultEntry>): SearchResultEntry {
  return {
    target: '',
    targetType: 'ModelPath',
    sourceConfigPath: 'mapping.xml',
    sourceComponent: '',
    sourceContext: '',
    ...overrides,
  };
}

describe('findNodeForSearchResult', () => {
  const index = buildSearchNodeIndex([root], configurations);

  it('resolves a binding in the definition the hit came from', () => {
    const result = hit({ target: 'Invoice.Total', sourceContext: 'Binding: Invoice.Total', sourceDefinition: 'B' });
    expect(findNodeForSearchResult(result, configurations, index, registry)).toBe(bindingB);
  });

  it('finds a model field under the named container', () => {
    const result = hit({ sourceComponent: 'Lines.Amount', sourceContext: 'TypeDescriptor reference in model field' });
    expect(findNodeForSearchResult(result, configurations, index, registry)).toBe(field);
  });

  it('returns the root for a base model reference and null for an unknown file', () => {
    expect(findNodeForSearchResult(hit({ sourceContext: 'Base model reference' }), configurations, index, registry)).toBe(root);
    expect(findNodeForSearchResult(hit({ sourceConfigPath: 'other.xml' }), configurations, index, registry)).toBeNull();
  });
});

describe('findNodeForSearchResult with shared element GUIDs', () => {
  // A derived format and its base carry the same element GUID.
  const guid = '{11111111-2222-3333-4444-555555555555}';
  const baseElement = node('cfg-0-fmt', 'formatElement', 'Invoice', { data: { id: guid } });
  const derivedElement = node('cfg-1-fmt', 'formatElement', 'Invoice', { data: { id: guid }, configIndex: 1 });
  const baseRoot = node('cfg-0', 'file', 'Base', { data: { kind: 'Format' }, children: [baseElement] });
  const derivedRoot = node('cfg-1', 'file', 'Derived', { data: { kind: 'Format' }, configIndex: 1, children: [derivedElement] });
  // Not real formats, so no mapping definition is preferred.
  const formats = [
    { filePath: 'base.xml', content: { kind: 'DataModel' } },
    { filePath: 'derived.xml', content: { kind: 'DataModel' } },
  ];
  const formatIndex = buildSearchNodeIndex([baseRoot, derivedRoot], formats);

  const registry = new GUIDRegistry();
  for (const filePath of ['base.xml', 'derived.xml']) {
    registry.register({ guid, kind: 'FormatElement', name: 'Invoice', configFilePath: filePath, componentKind: ERComponentKind.Format });
  }

  it('resolves the GUID in the file the hit came from', () => {
    const fromBase = hit({ target: guid, targetType: 'GUID', sourceConfigPath: 'base.xml' });
    const fromDerived = hit({ target: guid, targetType: 'GUID', sourceConfigPath: 'derived.xml' });
    expect(findNodeForSearchResult(fromBase, formats, formatIndex, registry)).toBe(baseElement);
    expect(findNodeForSearchResult(fromDerived, formats, formatIndex, registry)).toBe(derivedElement);
  });
});
