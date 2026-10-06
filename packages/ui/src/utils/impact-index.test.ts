import { describe, expect, it } from 'vitest';
import { buildImpactIndex, findImpactEntities } from './impact-index';
import { invoiceWorkspace } from './invoice-workspace.test-fixture';

const configs = invoiceWorkspace();
const index = buildImpactIndex(configs);
const usages = (key: string) => ({
  mapping: index.mappingUsages.get(key) ?? [],
  format: index.formatUsages.get(key) ?? [],
});

describe('buildImpactIndex', () => {
  it('follows a table through a calculated list to every format element', () => {
    const { mapping, format } = usages('table|custinvoicetrans');
    expect(mapping.map(u => u.path)).toEqual(expect.arrayContaining(['InvoiceBase/Lines', 'InvoiceBase/Lines/ItemId', 'InvoiceBase/Lines/Quantity']));
    // Both formats read the lines; the CSV one through @.ItemId as well.
    const formats = new Set(format.map(u => u.configIndex));
    expect(formats).toEqual(new Set([2, 3]));
    const itemId = format.find(u => u.configIndex === 2 && u.displayName === 'ItemId');
    expect(itemId).toMatchObject({ role: 'value', via: 'InvoiceBase/Lines/ItemId' });
  });

  it('indexes table fields', () => {
    const { format } = usages('field|custinvoicetrans.itemid');
    expect(format.map(u => `${u.configIndex}:${u.displayName}`).sort()).toEqual(['2:ItemId', '3:ItemId']);
  });

  it('marks a table only used to select records as context', () => {
    const { format } = usages('table|custinvoicejour');
    const line = format.find(u => u.configIndex === 2 && u.displayName === 'ItemId');
    expect(line?.role).toBe('context');
    const invoiceNumber = format.find(u => u.displayName === 'InvoiceNumber');
    expect(invoiceNumber?.role).toBe('value');
  });

  it('indexes model fields by the record that declares them', () => {
    const { mapping, format } = usages('modelField|invoice model|invoiceline_1.itemid');
    expect(mapping.map(u => `${u.definition}:${u.role}`)).toEqual(expect.arrayContaining(['Customer invoice [InvoiceCustomer]:fills', 'Project invoice [InvoiceProject]:fills']));
    expect(format.length).toBe(2);
  });

  it('records the format datasources an element reads', () => {
    const gross = [...index.entities.values()].find(e => e.kind === 'datasource' && e.name === '$Gross');
    expect(gross).toBeDefined();
    expect(usages(gross!.key).format.map(u => u.displayName)).toEqual(['Gross']);
  });
});

describe('findImpactEntities', () => {
  it('ranks exact names first and skips unused entities', () => {
    const matches = findImpactEntities(index, 'ItemId');
    expect(matches[0].entity.name.toLowerCase()).toContain('itemid');
    expect(matches.map(m => m.entity.kind)).toEqual(expect.arrayContaining(['field', 'modelField']));
  });

  it('puts the entity a where-used was started from first', () => {
    const matches = findImpactEntities(index, 'ItemId', { target: { kind: 'modelField', container: 'InvoiceLine_1', field: 'ItemId' } });
    expect(matches[0]).toMatchObject({ score: 4, entity: { kind: 'modelField', container: 'InvoiceLine_1' } });
  });

  it('matches model field labels', () => {
    const labels: Record<string, string> = { '@"GER_LABEL:InvoiceId"': 'Číslo faktury' };
    const matches = findImpactEntities(index, 'číslo faktury', { labelOf: ref => (ref ? labels[ref] : undefined) });
    expect(matches[0]?.entity).toMatchObject({ kind: 'modelField', field: 'InvoiceId' });
  });
});
