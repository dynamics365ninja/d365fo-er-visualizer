import { describe, expect, it } from 'vitest';
import type { ErConfigSummary } from '@er-visualizer/fno-client';
import { isFnoComponentDownloadable } from '../../utils/fno-downloadable';
import { relatedConfigurationsForFormat } from './listing';

const ROOT = 'Bank statement model';
const DERIVED = 'Contoso bank statement model';

function row(
  componentType: ErConfigSummary['componentType'],
  configurationName: string,
  extra: Partial<ErConfigSummary>,
): ErConfigSummary {
  return { solutionName: ROOT, configurationName, componentType, hasContent: true, ...extra };
}

/**
 * The full listing of an import model the way `listComponents` flattens it:
 * depth-first, each row knowing its parent and nearest model. The models and
 * the base destination mapping come without an id, as F&O lists them.
 */
const tree: ErConfigSummary[] = [
  row('DataModel', ROOT, { ownerDataModelName: ROOT, parentConfigName: ROOT, derivationDepth: 0, childFormatGuid: 'bai2' }),
  row('ModelMapping', 'Bank statement mapping to destination', {
    ownerDataModelName: ROOT, parentConfigName: ROOT, derivationDepth: 1, hasContent: false,
  }),
  row('ModelMapping', 'Contoso mapping to destination', {
    ownerDataModelName: ROOT, parentConfigName: 'Bank statement mapping to destination', derivationDepth: 2, configurationGuid: 'dest-cz',
  }),
  row('Format', 'BAI2', { ownerDataModelName: ROOT, parentConfigName: ROOT, derivationDepth: 1, configurationGuid: 'bai2' }),
  row('Format', 'BAI2 (Contoso)', { ownerDataModelName: ROOT, parentConfigName: 'BAI2', derivationDepth: 2, configurationGuid: 'bai2-cz' }),
  row('DataModel', DERIVED, { ownerDataModelName: ROOT, parentConfigName: ROOT, derivationDepth: 1, childFormatGuid: 'abo' }),
  row('Format', 'ABO (CZ)', { ownerDataModelName: DERIVED, parentConfigName: DERIVED, derivationDepth: 2, configurationGuid: 'abo' }),
  row('ModelMapping', 'Contoso model mapping', {
    ownerDataModelName: DERIVED, parentConfigName: DERIVED, derivationDepth: 2, configurationGuid: 'mm-cz',
  }),
];

const byName = (name: string) => tree.find(c => c.configurationName === name)!;
const describeOffer = (format: ErConfigSummary, list = tree) => {
  const { candidates, mappingAmbiguous } = relatedConfigurationsForFormat(format, list, isFnoComponentDownloadable);
  return {
    rows: candidates.map(c => `${'  '.repeat(c.depth)}${c.comp.configurationName}${c.preselected ? ' ✓' : ''}`),
    mappingAmbiguous,
  };
};

describe('relatedConfigurationsForFormat', () => {
  it('offers the whole model chain and every mapping of it, base before derived', () => {
    // The reported case: only the last configuration of the hierarchy — the
    // derived one — used to be offered. Which mapping an import format ends
    // in is not in the listing, so they are all shown and none is ticked.
    expect(describeOffer(byName('ABO (CZ)'))).toEqual({
      rows: [
        'Bank statement model',
        `  ${DERIVED} ✓`,
        'Bank statement mapping to destination',
        '  Contoso mapping to destination',
        'Contoso model mapping',
      ],
      mappingAmbiguous: true,
    });
  });

  it('ticks a mapping when it is the only one that can be downloaded', () => {
    // The base destination mapping has no id: listed, but not a choice.
    expect(describeOffer(byName('BAI2 (Contoso)'))).toEqual({
      rows: [
        'Bank statement model ✓',
        'Bank statement mapping to destination',
        '  Contoso mapping to destination ✓',
      ],
      mappingAmbiguous: false,
    });
  });

  it('keeps the hierarchy when the list comes sorted by name', () => {
    const sorted = [...tree].sort((a, b) => b.configurationName.localeCompare(a.configurationName));
    expect(describeOffer(byName('BAI2 (Contoso)'), sorted).rows).toEqual([
      'Bank statement model ✓',
      'Bank statement mapping to destination',
      '  Contoso mapping to destination ✓',
    ]);
  });

  it('falls back to the format\'s own model names when the list has no model rows', () => {
    // A drill-down listing holds formats only.
    const mapping = row('ModelMapping', 'Statement mapping', { ownerDataModelName: ROOT, configurationGuid: 'm1' });
    const format = row('Format', 'Statement format', { ownerDataModelName: ROOT, configurationGuid: 'f1' });
    expect(describeOffer(format, [format, mapping]).rows).toEqual(['Statement mapping ✓']);
  });
});
