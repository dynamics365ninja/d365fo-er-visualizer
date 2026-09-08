import { describe, expect, it } from 'vitest';
import type { ERConfiguration } from '@er-visualizer/core';
import { relatedConfigIndices, relatedContainerRules, hitPassesContainerRule, entryContainerNames, reachableContainerNames } from './model-hierarchy.js';

type Kind = 'DataModel' | 'ModelMapping' | 'Format';

function makeConfig(
  name: string,
  kind: Kind,
  content: Record<string, unknown>,
  baseSolutionId?: string,
): ERConfiguration {
  return {
    filePath: `${name}.xml`,
    kind,
    solutionVersion: {
      dateTime: '',
      description: '',
      number: 1,
      publicVersionNumber: '1',
      versionStatus: 1,
      solution: {
        id: `{SOL-${name}}`,
        name,
        labels: [],
        vendor: { name: '', url: '' },
        contentRefId: '',
        ...(baseSolutionId ? { baseSolutionId } : {}),
      },
    },
    content: { kind, ...content },
  } as unknown as ERConfiguration;
}

const model = (name: string, modelId: string, baseSolutionId?: string) =>
  makeConfig(name, 'DataModel', { version: { model: { id: modelId } } }, baseSolutionId);

const mapping = (name: string, modelId: string) =>
  makeConfig(name, 'ModelMapping', { version: { mapping: { modelId } } });

const format = (name: string, modelId: string) =>
  makeConfig(name, 'Format', {
    formatMappingVersion: { formatMapping: { datasources: [{ modelInfo: { modelGuid: modelId } }] } },
  });

describe('relatedConfigIndices', () => {
  it('keeps an unrelated model tree out of a format\'s reach', () => {
    const configs = [
      format('invoice-format', '{MODEL-A}'),   // 0
      model('model-a', '{MODEL-A}'),           // 1
      mapping('mapping-a', '{MODEL-A}'),       // 2
      model('model-b', '{MODEL-B}'),           // 3 — unrelated
      mapping('mapping-b', '{MODEL-B}'),       // 4 — unrelated
    ];

    expect(Array.from(relatedConfigIndices(configs, 0)).sort()).toEqual([0, 1, 2]);
  });

  it('follows the base chain of a derived model', () => {
    const base = model('base-model', '{MODEL-BASE}');
    const derived = model('derived-model', '{MODEL-DERIVED}', base.solutionVersion.solution.id);
    const configs = [
      format('fmt', '{MODEL-DERIVED}'),        // 0
      derived,                                 // 1
      base,                                    // 2
      mapping('base-mapping', '{MODEL-BASE}'), // 3 — binds the base model
      model('other', '{MODEL-OTHER}'),         // 4
    ];

    expect(Array.from(relatedConfigIndices(configs, 0)).sort()).toEqual([0, 1, 2, 3]);
  });

  it('resolves the tree from a mapping or a model just as well as from a format', () => {
    const configs = [
      format('fmt', '{MODEL-A}'),  // 0
      model('model-a', '{MODEL-A}'), // 1
      mapping('map-a', '{MODEL-A}'), // 2
      model('model-b', '{MODEL-B}'), // 3
    ];

    expect(Array.from(relatedConfigIndices(configs, 2)).sort()).toEqual([1, 2]);
    expect(Array.from(relatedConfigIndices(configs, 1)).sort()).toEqual([1, 2]);
  });

  it('falls back to everything when nothing is open or the model is missing', () => {
    const configs = [
      format('fmt', '{MODEL-A}'),
      model('model-b', '{MODEL-B}'),
    ];

    expect(relatedConfigIndices(configs, null).size).toBe(2);
    // The format's model is not loaded, so only the format itself is related.
    expect(Array.from(relatedConfigIndices(configs, 0))).toEqual([0]);
  });
});

// A model routinely carries several unrelated root containers; the container
// rules decide which of them a search started from a format may look at.
const containerModel = (name: string, modelId: string, containers: Array<{ name: string; items?: Array<{ name: string; typeDescriptor?: string }> }>) =>
  makeConfig(name, 'DataModel', {
    version: {
      model: {
        id: modelId,
        containers: containers.map(c => ({ id: c.name, name: c.name, items: (c.items ?? []).map(i => ({ name: i.name, type: 0, typeDescriptor: i.typeDescriptor })) })),
      },
    },
  });

const entryFormat = (name: string, modelId: string, container: string) =>
  makeConfig(name, 'Format', {
    formatMappingVersion: {
      formatMapping: { datasources: [{ modelInfo: { modelGuid: modelId, dataContainerDescriptorName: container } }] },
    },
  });

const INVOICE_MODEL = containerModel('model-a', '{MODEL-A}', [
  { name: 'SalesInvoice', items: [{ name: 'Lines', typeDescriptor: 'InvoiceLine' }, { name: 'Number' }] },
  { name: 'InvoiceLine', items: [{ name: 'Amount' }] },
  { name: 'TMSCommercialInvoice', items: [{ name: 'Freight', typeDescriptor: 'TMSLine' }] },
  { name: 'TMSLine', items: [{ name: 'Weight' }] },
]);

describe('entryContainerNames', () => {
  it('reads the root descriptor a format enters its model through', () => {
    expect(Array.from(entryContainerNames(entryFormat('fmt', '{MODEL-A}', 'SalesInvoice')))).toEqual(['SalesInvoice']);
  });

  it('imposes no entry point for a data model opened on its own', () => {
    expect(entryContainerNames(INVOICE_MODEL).size).toBe(0);
  });
});

describe('reachableContainerNames', () => {
  it('walks typeDescriptor links and stops at the unrelated tree', () => {
    const model = (INVOICE_MODEL.content as any).version.model;
    const reached = reachableContainerNames(model, new Set(['SalesInvoice']));
    expect(Array.from(reached).sort()).toEqual(['InvoiceLine', 'SalesInvoice']);
  });
});

describe('relatedContainerRules', () => {
  it('hides hits under a root the format never enters', () => {
    const configs = [entryFormat('fmt', '{MODEL-A}', 'SalesInvoice'), INVOICE_MODEL];
    const rules = relatedContainerRules(configs, 0);
    const rule = rules.get(1);

    expect(hitPassesContainerRule(rule, 'SalesInvoice.Number')).toBe(true);
    expect(hitPassesContainerRule(rule, 'InvoiceLine.Amount')).toBe(true);
    expect(hitPassesContainerRule(rule, 'TMSCommercialInvoice.Freight')).toBe(false);
    expect(hitPassesContainerRule(rule, 'TMSLine.Weight')).toBe(false);
  });

  it('lets cross-refs that are not container paths through untouched', () => {
    const configs = [entryFormat('fmt', '{MODEL-A}', 'SalesInvoice'), INVOICE_MODEL];
    const rule = relatedContainerRules(configs, 0).get(1);

    // A base-model reference is emitted with the solution name, not a path.
    expect(hitPassesContainerRule(rule, 'AC Gaston invoice model')).toBe(true);
  });

  it('drops mapping definitions rooted outside the entry points', () => {
    const multiMapping = makeConfig('map', 'ModelMapping', {
      version: {
        mapping: { modelId: '{MODEL-A}', name: 'SalesMap', dataContainerDescriptor: 'SalesInvoice' },
        mappings: [
          { modelId: '{MODEL-A}', name: 'SalesMap', dataContainerDescriptor: 'SalesInvoice' },
          { modelId: '{MODEL-A}', name: 'TMSMap', dataContainerDescriptor: 'TMSCommercialInvoice' },
        ],
      },
    });
    const rules = relatedContainerRules([entryFormat('fmt', '{MODEL-A}', 'SalesInvoice'), multiMapping], 0);
    const rule = rules.get(1);

    expect(hitPassesContainerRule(rule, 'SalesMap')).toBe(true);
    expect(hitPassesContainerRule(rule, 'TMSMap')).toBe(false);
  });

  it('stays out of the way when the entry point matches nothing in the model', () => {
    const configs = [entryFormat('fmt', '{MODEL-A}', 'SomethingElse'), INVOICE_MODEL];
    expect(relatedContainerRules(configs, 0).has(1)).toBe(false);
  });
});
