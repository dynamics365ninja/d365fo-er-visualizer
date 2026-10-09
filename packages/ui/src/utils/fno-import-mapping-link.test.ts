import { describe, it, expect } from 'vitest';
import {
  admitMapping,
  importFormatGuidsInMapping,
  importMappingLink,
  loadedFormatIdentity,
  mappingDefinitionIds,
  mappingSettlesWalk,
  mappingShape,
} from './fno-import-mapping-link';

const ZERO = '00000000-0000-0000-0000-000000000000';
/** Inner ERTextFormat id of the loaded format — what FormatGUID carries. */
const OUR_FORMAT = 'f0000001-3333-4333-8333-333333333333';
/** ERSolution id of the same configuration — what the listing hands out. */
const OUR_SOLUTION = '50000001-5555-4555-8555-555555555555';
const OTHER_FORMAT = 'f0000002-4444-4444-8444-444444444444';
const MODEL = '11111111-1111-4111-8111-111111111111';

/** The mapping an import format has on itself: the format fills the model. */
function formatToModelMapping(formatGuid: string): string {
  return [
    '<ErFnoBundle Name="Statement import mapping">',
    '<ERModelMappingVersion ID.="{MAP},1" Number="1"><Mapping>',
    `<ERModelMapping ID.="{MAP}" Name="Statement import mapping" DataContainerDescriptor="Statement" Model="{${MODEL}}">`,
    '<Datasource><ERModelDefinition><Contents.><ERModelItemDefinition><ValueDefinition>',
    '<ERModelItemValueDefinition Name="format"><ValueSource>',
    `<ERImportFormatDatasource FormatGUID="{${formatGuid.toUpperCase()}}" />`,
    '</ValueSource></ERModelItemValueDefinition>',
    '</ValueDefinition></ERModelItemDefinition></Contents.></ERModelDefinition></Datasource>',
    '</ERModelMapping></Mapping></ERModelMappingVersion></ErFnoBundle>',
  ].join('');
}

/**
 * The mapping an import format ends in: model definition empty, the bindings
 * write the filled model into D365FO datasources.
 */
const fromModelMapping =
  '<ErFnoBundle Name="Statement mapping to destination">' +
  '<ERModelMappingVersion ID.="{DEST},20" Number="20"><Mapping>' +
  `<ERModelMapping ID.="{DEST}" Name="Statement mapping to destination" DataContainerDescriptor="BankStatement" Model="{${MODEL}}">` +
  '<Datasource><ERModelDefinition><Contents. /></ERModelDefinition></Datasource>' +
  '<Binding><ERDataContainerBinding><Contents.>' +
  '<ERModelItemBinding Expression="model.Statement.Amount" />' +
  '</Contents.></ERDataContainerBinding></Binding>' +
  '</ERModelMapping></Mapping></ERModelMappingVersion></ErFnoBundle>';

/** The export side: the model definition is filled from AX datasources. */
const toModelMapping =
  '<ErFnoBundle Name="Invoice model mapping">' +
  '<ERModelMappingVersion ID.="{EXP},3" Number="3"><Mapping>' +
  `<ERModelMapping ID.="{EXP}" Name="Invoice model mapping" DataContainerDescriptor="SalesInvoice" Model="{${MODEL}}">` +
  '<Datasource><ERModelDefinition><Contents.><ERModelItemDefinition><ValueDefinition>' +
  '<ERModelItemValueDefinition Name="CustInvoiceJour"><ValueSource>' +
  '<ERAxTableDatasource TableName="CustInvoiceJour" />' +
  '</ValueSource></ERModelItemValueDefinition>' +
  '</ValueDefinition></ERModelItemDefinition></Contents.></ERModelDefinition></Datasource>' +
  '</ERModelMapping></Mapping></ERModelMappingVersion></ErFnoBundle>';

describe('importFormatGuidsInMapping', () => {
  it('reads FormatGUID out of every ERImportFormatDatasource, braces and case normalized', () => {
    expect([...importFormatGuidsInMapping(formatToModelMapping(OUR_FORMAT))]).toEqual([OUR_FORMAT]);
  });

  it('collects several datasources and drops the zero GUID', () => {
    const xml =
      `<ERImportFormatDatasource FormatGUID="{${OUR_FORMAT}}"/>` +
      `<ERImportFormatDatasource FormatGUID="${OTHER_FORMAT}"/>` +
      `<ERImportFormatDatasource FormatGUID="{${ZERO}}"/>`;
    expect(importFormatGuidsInMapping(xml)).toEqual(new Set([OUR_FORMAT, OTHER_FORMAT]));
  });

  it('ignores a FormatGUID that is not inside an ERImportFormatDatasource tag', () => {
    // ERFormatMapping.Format on an export mapping is a different relation and
    // must not be mistaken for the import link.
    const xml = `<ERFormatMapping ID.="{X}" Format="{${OUR_FORMAT}}" FormatGUID="{${OUR_FORMAT}}"/>`;
    expect(importFormatGuidsInMapping(xml).size).toBe(0);
  });
});

describe('mappingShape', () => {
  it('recognizes the format→model mapping an import format carries', () => {
    expect(mappingShape(formatToModelMapping(OUR_FORMAT))).toBe('format-to-model');
  });

  it('recognizes an empty model definition as the from-model (destination) mapping', () => {
    expect(mappingShape(fromModelMapping)).toBe('from-model');
  });

  it('recognizes a model definition filled from datasources as the export side', () => {
    expect(mappingShape(toModelMapping)).toBe('to-model');
  });

  it('keeps the format link ahead of the filled-definition test', () => {
    // The mapping placed on an import format has its model definition filled
    // too — with the format itself as the datasource. Testing "filled" first
    // would file it as the export side and the walk would reject its own
    // format's mapping.
    const mapping = formatToModelMapping(OUR_FORMAT);
    expect(mapping).toContain('<ValueSource>');
    expect(mappingShape(mapping)).toBe('format-to-model');
  });

  it('does not mistake binding expressions for a filled model definition', () => {
    // The destination mapping is all bindings and no datasources — looking at
    // the whole payload instead of the <Datasource> sections would call it
    // to-model and send the walk off after another mapping.
    expect(fromModelMapping).toContain('ERModelItemBinding');
    expect(mappingShape(fromModelMapping)).toBe('from-model');
  });
});

describe('importMappingLink', () => {
  const ours = new Set([OUR_FORMAT, OUR_SOLUTION]);

  it('recognizes the mapping of a format in the load', () => {
    expect(importMappingLink(formatToModelMapping(OUR_FORMAT), ours)).toBe('bound');
  });

  it('rejects a format→model mapping that belongs to another format', () => {
    // What descriptor-name probing returns when a model carries one import
    // mapping per bank: a real mapping, just not ours.
    expect(importMappingLink(formatToModelMapping(OTHER_FORMAT), ours)).toBe('other-format');
  });

  it('reports the destination and export shapes as themselves', () => {
    expect(importMappingLink(fromModelMapping, ours)).toBe('from-model');
    expect(importMappingLink(toModelMapping, ours)).toBe('to-model');
  });
});

describe('mappingSettlesWalk', () => {
  const importOnly = { hasImportFormat: true, hasExportFormat: false };

  it('keeps the walk going only for a mapping that cannot be ours', () => {
    expect(mappingSettlesWalk('other-format', importOnly)).toBe(false);
    expect(mappingSettlesWalk('to-model', importOnly)).toBe(false);
    expect(mappingSettlesWalk('bound', importOnly)).toBe(true);
    // The one that matters: an import format's destination mapping names no
    // format, so demanding a `bound` verdict would report the right mapping as
    // missing and walk on for nothing.
    expect(mappingSettlesWalk('from-model', importOnly)).toBe(true);
  });

  it('accepts the export-side mapping when an export format needs it', () => {
    expect(mappingSettlesWalk('to-model', { hasImportFormat: true, hasExportFormat: true })).toBe(true);
  });

  it('leaves a pure export load on first-success-wins', () => {
    const exportOnly = { hasImportFormat: false, hasExportFormat: true };
    for (const link of ['bound', 'other-format', 'to-model', 'from-model'] as const) {
      expect(mappingSettlesWalk(link, exportOnly)).toBe(true);
    }
  });
});

describe('loadedFormatIdentity', () => {
  it('collects solution, version, format and format-mapping ids of import formats only', () => {
    const { importGuids, hasImportFormat, hasExportFormat } = loadedFormatIdentity([
      {
        kind: 'Format',
        solutionVersion: { solution: { id: `{${OUR_SOLUTION}}` } },
        content: {
          direction: 'Import',
          formatVersion: { id: `{${OUR_FORMAT}},24`, format: { id: `{${OUR_FORMAT}}` } },
          formatMappingVersion: { id: '{aaaaaaaa-0000-4000-8000-000000000001}' },
        },
      },
      {
        kind: 'Format',
        solutionVersion: { solution: { id: `{${OTHER_FORMAT}}` } },
        content: { direction: 'Export', formatVersion: { format: { id: `{${OTHER_FORMAT}}` } } },
      },
      { kind: 'DataModel', solutionVersion: { solution: { id: `{${ZERO}}` } }, content: {} },
    ]);
    expect(importGuids.has(OUR_SOLUTION)).toBe(true);
    expect(importGuids.has(OUR_FORMAT)).toBe(true);
    // `{guid},N` carries a revision suffix — the id still has to match.
    expect(importGuids.has('aaaaaaaa-0000-4000-8000-000000000001')).toBe(true);
    // An export format is resolved through its own XML — it has no need of this
    // link, and including it would let an unrelated mapping pass as "bound".
    expect(importGuids.has(OTHER_FORMAT)).toBe(false);
    expect(importGuids.has(ZERO)).toBe(false);
    expect(hasImportFormat).toBe(true);
    expect(hasExportFormat).toBe(true);
  });

  it('reports a load with no format at all as neither', () => {
    const id = loadedFormatIdentity([{ kind: 'DataModel', content: {} }]);
    expect(id.hasImportFormat).toBe(false);
    expect(id.hasExportFormat).toBe(false);
  });
});

describe('loadedFormatIdentity — mappings the import formats came with', () => {
  it('collects the ids of the mapping definitions embedded in import formats', () => {
    const { ownMappingIds } = loadedFormatIdentity([
      {
        kind: 'Format',
        content: {
          direction: 'Import',
          formatVersion: { format: { id: `{${OUR_FORMAT}}` } },
          embeddedModelMappingVersions: [{ mappings: [{ id: '{A4A06A3C-9FA8-423F-9FA0-47D02EB9005B}' }] }],
        },
      },
      {
        kind: 'Format',
        content: {
          direction: 'Export',
          embeddedModelMappingVersions: [{ mappings: [{ id: '{EEEEEEEE-0000-4000-8000-000000000001}' }] }],
        },
      },
    ]);
    expect([...ownMappingIds]).toEqual(['a4a06a3c-9fa8-423f-9fa0-47d02eb9005b']);
  });
});

describe('mappingDefinitionIds', () => {
  it('reads the id of every mapping definition in a payload', () => {
    const xml =
      '<ErFnoBundle><ERModelMapping ID.="{A4A06A3C-9FA8-423F-9FA0-47D02EB9005B}" Name="a" />' +
      '<ERModelMapping Name="b" ID.="{11111111-2222-4333-8444-555555555555}"></ERModelMapping></ErFnoBundle>';
    expect([...mappingDefinitionIds(xml)]).toEqual([
      'a4a06a3c-9fa8-423f-9fa0-47d02eb9005b',
      '11111111-2222-4333-8444-555555555555',
    ]);
    expect(mappingDefinitionIds('<ErFnoBundle />').size).toBe(0);
  });
});

describe('admitMapping', () => {
  const importOnly = { hasImportFormat: true, hasExportFormat: false };
  const mixed = { hasImportFormat: true, hasExportFormat: true };
  const exportOnly = { hasImportFormat: false, hasExportFormat: true };

  it('keeps a mapping that parses another format out of the workspace', () => {
    // The reported case: a model lookup answered with some other bank format's
    // mapping, which then sat in the workspace as if it were the right one.
    expect(admitMapping('other-format', importOnly, false)).toBe('other-format');
    expect(admitMapping('other-format', mixed, false)).toBe('other-format');
  });

  it('does not load the import format\'s own mapping twice', () => {
    expect(admitMapping('bound', importOnly, true)).toBe('in-format');
    // A format that came without its mapping (older F&O) still gets it.
    expect(admitMapping('bound', importOnly, false)).toBe('load');
  });

  it('loads the export side only next to an export format', () => {
    expect(admitMapping('to-model', importOnly, false)).toBe('export-side');
    expect(admitMapping('to-model', mixed, false)).toBe('load');
  });

  it('loads a destination mapping', () => {
    expect(admitMapping('from-model', importOnly, false)).toBe('load');
  });

  it('leaves loads without an import format alone', () => {
    for (const link of ['bound', 'other-format', 'to-model', 'from-model'] as const) {
      expect(admitMapping(link, exportOnly, false)).toBe('load');
    }
    expect(admitMapping(null, importOnly, false)).toBe('load');
  });
});
