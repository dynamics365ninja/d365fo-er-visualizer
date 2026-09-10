import { describe, it, expect } from 'vitest';
import { getActiveFormatDescriptors, collectActiveScopeNodeIds } from './active-format-scope.js';
import type { TreeNode } from '../state/store.js';

function formatConfig(descriptor: string): any {
  return {
    solutionVersion: { solution: { name: `Format ${descriptor}` } },
    content: {
      kind: 'Format',
      formatMappingVersion: {
        formatMapping: {
          datasources: [
            { name: 'model', modelInfo: { dataContainerDescriptorName: descriptor }, children: [] },
          ],
        },
      },
    },
  };
}

function mappingNode(id: string, descriptor: string): TreeNode {
  return { id, name: `Mapping: ${descriptor}`, icon: '🔗', type: 'mapping', data: { dataContainerDescriptor: descriptor } };
}

function rootContainerNode(id: string, name: string): TreeNode {
  return { id, name, icon: '🏠', type: 'container', data: { isRoot: true, name } };
}

describe('getActiveFormatDescriptors', () => {
  const configurations = [formatConfig('CustomerInvoice'), formatConfig('SalesInvoice')] as any[];

  it('returns the descriptors of the requested format, lowercased', () => {
    expect(getActiveFormatDescriptors(configurations, 1)).toEqual(new Set(['salesinvoice']));
  });

  it('returns null when no configuration is active', () => {
    expect(getActiveFormatDescriptors(configurations, null)).toBeNull();
  });

  it('returns null for a non-format configuration', () => {
    const configs = [{ content: { kind: 'ModelMapping' } }] as any[];
    expect(getActiveFormatDescriptors(configs, 0)).toBeNull();
  });
});

describe('collectActiveScopeNodeIds', () => {
  const modelMappingTree: TreeNode = {
    id: 'cfg-0',
    name: 'Invoice model mapping',
    icon: '📄',
    type: 'file',
    children: [
      mappingNode('cfg-0-mapping-0', 'CustomerInvoice'),
      mappingNode('cfg-0-mapping-1', 'SalesInvoice'),
    ],
  };

  const dataModelTree: TreeNode = {
    id: 'cfg-1',
    name: 'Invoice model',
    icon: '📄',
    type: 'file',
    children: [
      {
        id: 'cfg-1-model-roots',
        name: 'Roots',
        icon: '📂',
        type: 'section',
        children: [
          rootContainerNode('cfg-1-container-0', 'CustomerInvoice'),
          rootContainerNode('cfg-1-container-1', 'SalesInvoice'),
        ],
      },
    ],
  };

  it('marks the mapping definition and model root of the active format', () => {
    const ids = collectActiveScopeNodeIds([modelMappingTree, dataModelTree], new Set(['salesinvoice']));
    expect(ids).toEqual(new Set(['cfg-0-mapping-1', 'cfg-1-container-1']));
  });

  it('follows the active format when it changes', () => {
    const ids = collectActiveScopeNodeIds([modelMappingTree, dataModelTree], new Set(['customerinvoice']));
    expect(ids).toEqual(new Set(['cfg-0-mapping-0', 'cfg-1-container-0']));
  });

  it('stays empty when nothing is scoped', () => {
    expect(collectActiveScopeNodeIds([modelMappingTree], null).size).toBe(0);
    expect(collectActiveScopeNodeIds([modelMappingTree], new Set()).size).toBe(0);
  });

  it('does not badge a configuration that offers no choice', () => {
    const single: TreeNode = {
      id: 'cfg-2',
      name: 'Single mapping',
      icon: '📄',
      type: 'file',
      children: [mappingNode('cfg-2-mapping-0', 'SalesInvoice')],
    };
    expect(collectActiveScopeNodeIds([single], new Set(['salesinvoice'])).size).toBe(0);
  });

  it('ignores descriptors no loaded configuration provides', () => {
    expect(collectActiveScopeNodeIds([modelMappingTree], new Set(['unknownroot'])).size).toBe(0);
  });
});
