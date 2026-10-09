import { describe, expect, it } from 'vitest';
import { findRelatedRecentFiles, type RecentFile, type RelatedRecentFiles } from './persistence';

const BASE_MODEL = 'b0000000-0000-4000-8000-000000000001';
const DERIVED_MODEL = 'd0000000-0000-4000-8000-000000000001';

function recent(path: string, kind: RecentFile['kind'], extra: Partial<RecentFile>): RecentFile {
  return { path, name: path, kind, openedAt: 0, solutionName: path, ...extra };
}

// A format of a derived model, the derived model and its base, and the
// mappings of both: what the cache holds after a couple of F&O downloads.
const format = recent('ABO format', 'Format', { modelId: DERIVED_MODEL, solutionId: 'sol-format' });
const derivedModel = recent('Contoso statement model', 'DataModel', {
  modelId: DERIVED_MODEL, solutionId: 'sol-derived', baseSolutionId: 'sol-base',
});
const baseModel = recent('Statement model', 'DataModel', { modelId: BASE_MODEL, solutionId: 'sol-base' });
const baseMapping = recent('Statement mapping to destination', 'ModelMapping', {
  modelId: BASE_MODEL, solutionId: 'sol-map',
});
const derivedMapping = recent('Contoso mapping to destination', 'ModelMapping', {
  modelId: DERIVED_MODEL, solutionId: 'sol-map-cz', baseSolutionId: 'sol-map',
});
const all = [format, derivedMapping, derivedModel, baseMapping, baseModel];
const cached = new Set(all.map(f => f.path));

const offer = (related: RelatedRecentFiles) => ({
  dataModels: related.dataModels.map(r => `${'  '.repeat(r.depth)}${r.file.path}${r.preselected ? ' ✓' : ''}`),
  mappings: related.mappings.map(r => `${'  '.repeat(r.depth)}${r.file.path}${r.preselected ? ' ✓' : ''}`),
  mappingAmbiguous: related.mappingAmbiguous,
});

describe('findRelatedRecentFiles', () => {
  it('offers the base model and its mapping next to the derived ones', () => {
    // The reported case: matching the format's model id offered only the
    // derived model. The base is listed too; which mapping the format uses
    // cannot be told, so the user picks.
    expect(offer(findRelatedRecentFiles(format, all, [], cached))).toEqual({
      dataModels: ['Statement model', '  Contoso statement model ✓'],
      mappings: ['Statement mapping to destination', '  Contoso mapping to destination'],
      mappingAmbiguous: true,
    });
  });

  it('ticks the mapping when there is only one', () => {
    const related = findRelatedRecentFiles(format, [format, derivedModel, baseModel, baseMapping], [], cached);
    expect(offer(related).mappings).toEqual(['Statement mapping to destination ✓']);
    expect(related.mappingAmbiguous).toBe(false);
  });

  it('offers every cached copy of the model, ticking the newest', () => {
    const older = recent('Contoso statement model (older copy)', 'DataModel', {
      modelId: DERIVED_MODEL, solutionId: 'sol-derived-old', baseSolutionId: 'sol-base',
    });
    const files = [format, derivedModel, older];
    const related = findRelatedRecentFiles(format, files, [], new Set(files.map(f => f.path)));
    expect(offer(related).dataModels).toEqual(['Contoso statement model ✓', 'Contoso statement model (older copy)']);
  });

  it('leaves out what is not cached and does not offer a base it cannot place', () => {
    // An entry recorded before the base was remembered has no `baseSolutionId`.
    const { baseSolutionId: _ignored, ...withoutBase } = derivedModel;
    const files = [format, withoutBase, baseModel, baseMapping];
    const related = findRelatedRecentFiles(format, files, [], new Set([withoutBase.path, baseMapping.path]));
    expect(offer(related)).toEqual({
      dataModels: ['Contoso statement model ✓'],
      mappings: [],
      mappingAmbiguous: false,
    });
  });

  it('offers the formats of a model that is being opened', () => {
    const related = findRelatedRecentFiles(derivedModel, all, [], cached);
    expect(related.formats.map(r => [r.file.path, r.preselected])).toEqual([['ABO format', true]]);
    // The base model is offered, but opening a model is no reason to tick it.
    expect(offer(related).dataModels).toEqual(['Statement model']);
  });
});
