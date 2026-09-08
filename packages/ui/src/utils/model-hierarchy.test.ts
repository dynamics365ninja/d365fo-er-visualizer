import { describe, expect, it } from 'vitest';
import type { ERConfiguration } from '@er-visualizer/core';
import { relatedConfigIndices } from './model-hierarchy.js';

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
