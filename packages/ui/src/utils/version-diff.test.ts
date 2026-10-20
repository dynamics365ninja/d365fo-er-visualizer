import { describe, expect, it } from 'vitest';
import { parseERConfiguration, type ERConfiguration, type ERDataModelContent, type ERFormatContent, type ERFormatElement, type ERModelMappingContent } from '@er-visualizer/core';
import {
  buildVersionDiffCsv,
  diffConfigurations,
  diffListItems,
  inlineChange,
  longestIncreasingRun,
  orderVersions,
  type DiffEntry,
  type VersionDiff,
} from './version-diff';
import { MAPPING_XML, MODEL_XML, XML_FORMAT_XML, CSV_FORMAT_XML } from './invoice-workspace.test-fixture';

function withVersion(cfg: ERConfiguration, version: string, filePath = `${cfg.filePath}@${version}`): ERConfiguration {
  const next = structuredClone(cfg);
  next.filePath = filePath;
  next.solutionVersion.publicVersionNumber = version;
  return next;
}

function format(cfg: ERConfiguration): ERFormatContent {
  return cfg.content as ERFormatContent;
}

/** The first element of that name below the root (the file component is named like the root XML element). */
function findElement(root: ERFormatElement, name: string): ERFormatElement {
  const queue = [...root.children];
  while (queue.length > 0) {
    const element = queue.shift()!;
    if (element.name === name) return element;
    queue.push(...element.children);
  }
  throw new Error(`no element ${name}`);
}

function entries(diff: VersionDiff, kind?: string): DiffEntry[] {
  return diff.sections.filter(s => !kind || s.kind === kind).flatMap(s => s.entries);
}

function entry(diff: VersionDiff, path: string, kind?: string): DiffEntry | undefined {
  return entries(diff, kind).find(e => e.path === path);
}

describe('diffConfigurations — format', () => {
  const base = parseERConfiguration(XML_FORMAT_XML, 'invoice.xml');

  it('finds nothing between a version and its copy', () => {
    const diff = diffConfigurations(withVersion(base, '1'), withVersion(base, '2'));
    expect(diff.sections).toEqual([]);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(diff.sameConfiguration).toBe(true);
  });

  it('reports a changed attribute and a changed binding on the element they belong to', () => {
    const older = withVersion(base, '1');
    const newer = withVersion(base, '2');
    const root = format(newer).formatVersion.format.rootElement;
    const invoiceNumber = findElement(root, 'InvoiceNumber').children[0];
    invoiceNumber.attributes.MaximalLength = '35';
    const binding = format(newer).formatMappingVersion.formatMapping.bindings
      .find(b => b.expressionAsString === 'model.InvoiceBase.CompanyInfo.Name')!;
    binding.expressionAsString = 'model.InvoiceBase.CompanyInfo.VATNum';

    const diff = diffConfigurations(older, newer);
    expect(entry(diff, 'Invoice/Invoice/InvoiceNumber/String')?.properties).toEqual([
      { key: '@MaximalLength', before: '20', after: '35' },
    ]);
    expect(entry(diff, 'Invoice/Invoice/SellerName/String')?.properties).toEqual([
      { key: 'binding', before: 'model.InvoiceBase.CompanyInfo.Name', after: 'model.InvoiceBase.CompanyInfo.VATNum' },
    ]);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 2 });
  });

  it('keeps the older version on the left whichever side is passed first', () => {
    const older = withVersion(base, '68.2');
    const newer = withVersion(base, '68.10');
    expect(orderVersions(newer, older)).toEqual([older, newer]);
    const diff = diffConfigurations(newer, older);
    expect(diff.older).toBe(older);
    expect(diff.header.find(h => h.key === 'version')).toEqual({ key: 'version', before: '68.2', after: '68.10' });
  });

  it('lists added and removed elements in document order, removed ones where they used to be', () => {
    const older = withVersion(base, '1');
    const newer = withVersion(base, '2');
    const invoice = findElement(format(newer).formatVersion.format.rootElement, 'Invoice');
    const bicIndex = invoice.children.findIndex(c => c.name === 'BIC');
    invoice.children.splice(bicIndex, 1);
    invoice.children.push({ id: '{E0000000-0000-4000-8000-000000000001}', name: 'DueDate', elementType: 'XMLElement', children: [], attributes: {} });

    const diff = diffConfigurations(older, newer);
    const structure = entries(diff, 'structure');
    expect(structure.map(e => `${e.change} ${e.path}`)).toEqual([
      'removed Invoice/Invoice/BIC',
      'removed Invoice/Invoice/BIC/String',
      'added Invoice/Invoice/DueDate',
    ]);
    expect(structure[1].properties).toContainEqual({ key: '@MaximalLength', before: '11' });
    expect(structure[1].locateOlder).toEqual({ type: 'formatElement', id: expect.any(String) });
    expect(structure[2].locateNewer).toEqual({ type: 'formatElement', id: '{E0000000-0000-4000-8000-000000000001}' });
  });

  it('matches a renamed element by its GUID and says where it was', () => {
    const newer = withVersion(base, '2');
    findElement(format(newer).formatVersion.format.rootElement, 'SellerName').name = 'Seller';
    const diff = diffConfigurations(withVersion(base, '1'), newer);
    const renamed = entry(diff, 'Invoice/Invoice/Seller');
    expect(renamed?.change).toBe('changed');
    expect(renamed?.previousPath).toBe('Invoice/Invoice/SellerName');
    expect(renamed?.properties).toEqual([{ key: 'name', before: 'SellerName', after: 'Seller' }]);
    // Its child only moved along with the parent's new name — not a change.
    expect(entry(diff, 'Invoice/Invoice/Seller/String')).toBeUndefined();
  });

  it('reports the moved one of reordered siblings, not every sibling that shifted', () => {
    const newer = withVersion(base, '2');
    const line = findElement(format(newer).formatVersion.format.rootElement, 'Line');
    // ItemId, Quantity, Total → Quantity, Total, ItemId
    line.children.push(line.children.shift()!);
    const diff = diffConfigurations(withVersion(base, '1'), newer);
    const structure = entries(diff, 'structure');
    expect(structure).toHaveLength(1);
    expect(structure[0].path).toBe('Invoice/Invoice/Lines/Line/ItemId');
    expect(structure[0].properties).toEqual([{ key: 'position', before: '1', after: '3' }]);
  });

  it('reports an element moved under another parent', () => {
    const newer = withVersion(base, '2');
    const root = format(newer).formatVersion.format.rootElement;
    const invoice = findElement(root, 'Invoice');
    const gross = invoice.children.splice(invoice.children.findIndex(c => c.name === 'Gross'), 1)[0];
    findElement(root, 'TaxTotal').children.push(gross);
    const diff = diffConfigurations(withVersion(base, '1'), newer);
    const moved = entry(diff, 'Invoice/Invoice/TaxTotal/Gross');
    expect(moved?.properties).toEqual([{ key: 'parent', before: 'Invoice/Invoice', after: 'Invoice/Invoice/TaxTotal' }]);
  });

  it('compares format data sources, conditions on properties and the format enumerations', () => {
    const newer = withVersion(base, '2');
    const mapping = format(newer).formatMappingVersion.formatMapping;
    mapping.datasources.find(ds => ds.name === '$Gross')!.calculatedField!.expressionAsString = 'model.InvoiceBase.InvoiceAmount * 1.2';
    mapping.bindings.find(b => b.propertyName === 'Enabled')!.expressionAsString = 'NOT(ISEMPTY(model.InvoiceBase.Notes))';
    const diff = diffConfigurations(withVersion(base, '1'), newer);
    expect(entry(diff, '$Gross', 'datasources')?.properties).toEqual([
      { key: 'expression', before: 'model.InvoiceBase.InvoiceAmount * 1.21', after: 'model.InvoiceBase.InvoiceAmount * 1.2' },
    ]);
    expect(entry(diff, 'Invoice/Invoice/Note')?.properties).toEqual([
      { key: 'binding:Enabled', before: 'model.InvoiceBase.Notes <> ""', after: 'NOT(ISEMPTY(model.InvoiceBase.Notes))' },
    ]);
  });

  it('refuses to compare configurations of different kinds', () => {
    const model = parseERConfiguration(MODEL_XML, 'model.xml');
    expect(() => diffConfigurations(base, model)).toThrow();
  });

  it('notes when the two sides are different configurations', () => {
    const other = parseERConfiguration(CSV_FORMAT_XML, 'csv.xml');
    const diff = diffConfigurations(base, other);
    expect(diff.sameConfiguration).toBe(false);
    expect(diff.counts.added + diff.counts.removed).toBeGreaterThan(0);
  });
});

describe('diffConfigurations — model mapping', () => {
  const base = parseERConfiguration(MAPPING_XML, 'mapping.xml');

  it('reports bindings and data sources per definition', () => {
    const newer = withVersion(base, '2');
    const definitions = (newer.content as ERModelMappingContent).version.mappings;
    const customer = definitions.find(m => m.dataContainerDescriptor === 'InvoiceCustomer')!;
    customer.bindings.find(b => b.path === 'InvoiceBase/InvoiceAmount')!.expressionAsString = 'ROUND($Invoice.InvoiceAmount, 3)';
    customer.bindings.push({ path: 'InvoiceBase/Notes', expressionAsString: '$Invoice.Notes' });
    customer.datasources = customer.datasources.filter(ds => ds.name !== 'PaymMode');

    const diff = diffConfigurations(withVersion(base, '1'), newer);
    const bindings = diff.sections.filter(s => s.kind === 'bindings');
    expect(bindings).toHaveLength(1);
    expect(bindings[0].scope).toBe('Customer invoice (InvoiceCustomer)');
    expect(bindings[0].entries.map(e => `${e.change} ${e.path}`)).toEqual([
      'changed InvoiceBase/InvoiceAmount',
      'added InvoiceBase/Notes',
    ]);
    expect(bindings[0].definitionNewer).toBeTruthy();
    const removed = entry(diff, 'PaymMode', 'datasources');
    expect(removed?.change).toBe('removed');
    expect(removed?.properties).toContainEqual({ key: 'enum', before: 'CustPaymMode' });
  });

  it('reports an added mapping definition', () => {
    const newer = withVersion(base, '2');
    const version = (newer.content as ERModelMappingContent).version;
    version.mappings.push({ ...structuredClone(version.mappings[0]), id: '{B1000000-0000-4000-8000-000000000009}', name: 'Credit note', dataContainerDescriptor: 'InvoiceCredit' });
    const diff = diffConfigurations(withVersion(base, '1'), newer);
    const definitions = entries(diff, 'definitions');
    expect(definitions.map(e => `${e.change} ${e.path}`)).toEqual(['added Credit note (InvoiceCredit)']);
    // Everything inside a new definition is new.
    expect(diff.sections.some(s => s.scope === 'Credit note (InvoiceCredit)' && s.entries.every(e => e.change === 'added'))).toBe(true);
  });
});

describe('diffConfigurations — data model', () => {
  const base = parseERConfiguration(MODEL_XML, 'model.xml');

  it('reports added, removed and retyped fields and a relabelled record', () => {
    const newer = withVersion(base, '2');
    const containers = (newer.content as ERDataModelContent).version.model.containers;
    const invoice = containers.find(c => c.name === 'InvoiceBase_1')!;
    invoice.items = invoice.items.filter(i => i.name !== 'Notes');
    invoice.items.push({ name: 'DueDate', type: 7 });
    invoice.items.find(i => i.name === 'InvoiceAmount')!.type = 3;
    containers.find(c => c.name === 'CompanyInfo_1')!.label = '@GER_LABEL:Company';

    const diff = diffConfigurations(withVersion(base, '1'), newer);
    expect(entries(diff, 'fields').map(e => `${e.change} ${e.path}`)).toEqual([
      'changed InvoiceBase_1/InvoiceAmount',
      'removed InvoiceBase_1/Notes',
      'added InvoiceBase_1/DueDate',
    ]);
    expect(entry(diff, 'InvoiceBase_1/InvoiceAmount', 'fields')?.properties).toEqual([{ key: 'type', before: 'Real', after: 'Int64' }]);
    expect(entry(diff, 'InvoiceBase_1/DueDate', 'fields')?.locateNewer).toEqual({ type: 'field', container: 'InvoiceBase_1', field: 'DueDate' });
    expect(entry(diff, 'CompanyInfo_1', 'records')?.properties).toEqual([{ key: 'label', after: '@GER_LABEL:Company' }]);
  });

  it('reports changed label texts but not labels only one side carries', () => {
    const newer = withVersion(base, '2');
    const labels = newer.solutionVersion.solution.labels;
    labels.find(l => l.languageId === 'cs')!.labelValue = 'Číslo dokladu';
    labels.push({ labelId: 'GER_LABEL:Inherited', labelValue: 'From the base model', languageId: 'en-us' });
    const diff = diffConfigurations(withVersion(base, '1'), newer);
    expect(entries(diff, 'labels')).toEqual([expect.objectContaining({
      change: 'changed',
      path: 'GER_LABEL:InvoiceId (cs)',
      properties: [{ key: 'text', before: 'Číslo faktury', after: 'Číslo dokladu' }],
    })]);
  });
});

describe('helpers', () => {
  it('longestIncreasingRun keeps the longest run in order', () => {
    expect([...longestIncreasingRun([1, 2, 0])].sort()).toEqual([0, 1]);
    expect([...longestIncreasingRun([2, 0, 1])].sort()).toEqual([1, 2]);
    expect(longestIncreasingRun([]).size).toBe(0);
  });

  it('inlineChange isolates the part that differs', () => {
    expect(inlineChange('ROUND(x, 2)', 'ROUND(x, 3)')).toEqual({ prefix: 'ROUND(x, ', before: '2', after: '3', suffix: ')' });
    expect(inlineChange('abc', 'abc')).toEqual({ prefix: 'abc', before: '', after: '', suffix: '' });
    expect(inlineChange('a', 'ab')).toEqual({ prefix: 'a', before: '', after: 'b', suffix: '' });
  });

  it('writes one CSV row per changed property', () => {
    const base = parseERConfiguration(MODEL_XML, 'model.xml');
    const newer = withVersion(base, '2');
    (newer.content as ERDataModelContent).version.model.containers[0].items.push({ name: 'Extra', type: 6 });
    const csv = buildVersionDiffCsv(diffConfigurations(withVersion(base, '1'), newer), {
      headers: ['Section', 'Change', 'Path', 'Previous', 'Type', 'Property', 'Before', 'After'],
      change: c => c,
      section: s => s.kind,
      property: k => k,
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Section;Change;Path;Previous;Type;Property;Before;After');
    expect(lines.slice(1)).toEqual(['fields;added;InvoiceCustomer/Extra;;String;type;;String']);
  });
});

describe('diffListItems', () => {
  it('pairs items by name and marks the ones whose rest changed', () => {
    const before = ['Amount = SUM($T/Amount)', 'VatDate = MAX($T/VatDate)', 'Old = MIN($T/Old)'].join('\n');
    const after = ['Amount = SUM($T/Amount)', 'VatDate = MAX($T/Asl_VatDate)', 'New = MIN($T/New)'].join('\n');
    expect(diffListItems(before, after)).toEqual([
      { kind: 'same', before: 'Amount = SUM($T/Amount)', after: 'Amount = SUM($T/Amount)' },
      { kind: 'changed', before: 'VatDate = MAX($T/VatDate)', after: 'VatDate = MAX($T/Asl_VatDate)' },
      { kind: 'removed', before: 'Old = MIN($T/Old)' },
      { kind: 'added', after: 'New = MIN($T/New)' },
    ]);
  });

  it('treats a plain item as its own name and a missing side as an empty list', () => {
    expect(diffListItems(undefined, 'A\nB')).toEqual([{ kind: 'added', after: 'A' }, { kind: 'added', after: 'B' }]);
    expect(diffListItems('A\nB', 'A\nC').map(row => row.kind)).toEqual(['same', 'removed', 'added']);
  });
});
