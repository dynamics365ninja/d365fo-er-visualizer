import { describe, expect, it } from 'vitest';
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
