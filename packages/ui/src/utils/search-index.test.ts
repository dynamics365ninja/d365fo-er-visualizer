import { describe, expect, it } from 'vitest';
import { buildSearchIndex, excerptAround, searchIndex } from './search-index';
import { invoiceWorkspace } from './invoice-workspace.test-fixture';

const configs = invoiceWorkspace();
const index = buildSearchIndex(configs);
const top = (query: string, n = 5) => searchIndex(index, query).slice(0, n).map(m => `${m.doc.kind}:${m.doc.name}`);

describe('searchIndex', () => {
  it('finds format elements by name — the registry search never did', () => {
    expect(top('InvoiceNumber')[0]).toBe('formatElement:InvoiceNumber');
  });

  it('finds data model fields and records', () => {
    const hits = searchIndex(index, 'ItemId').map(m => m.doc.kind);
    expect(hits).toEqual(expect.arrayContaining(['modelField', 'formatElement', 'mappingBinding', 'formatBinding']));
    expect(top('InvoiceLine_1')[0]).toBe('modelRecord:InvoiceLine_1');
  });

  it('matches label texts in every language, with or without diacritics', () => {
    expect(top('Číslo faktury')[0]).toBe('modelField:InvoiceId');
    expect(top('cislo faktury')[0]).toBe('modelField:InvoiceId');
    expect(top('Invoice number')[0]).toBe('modelField:InvoiceId');
  });

  it('searches whole expressions, including function names', () => {
    const round = searchIndex(index, 'ROUND').map(m => `${m.doc.kind}:${m.field}`);
    expect(round).toEqual(expect.arrayContaining(['mappingBinding:expression']));
    expect(top('CONCATENATE')).toContain('formatBinding:Invoice');
  });

  it('finds datasources by their table and kind', () => {
    const hits = searchIndex(index, 'CustInvoiceTrans');
    expect(hits[0].doc).toMatchObject({ kind: 'datasource', name: 'CustInvoiceTrans', detail: 'CustInvoiceTrans' });
    expect(top('TaxGrouped')[0]).toBe('datasource:TaxGrouped');
  });

  it('ranks the element above the binding that shares its name', () => {
    const names = searchIndex(index, 'Quantity').map(m => m.doc.kind);
    expect(names.indexOf('formatElement')).toBeLessThan(names.indexOf('formatBinding'));
  });

  it('matches several words anywhere in a document', () => {
    expect(searchIndex(index, 'Lines ItemId').some(m => m.doc.kind === 'mappingBinding' && m.doc.path === 'InvoiceBase/Lines/ItemId')).toBe(true);
  });

  it('keeps the mapping definition of mapping documents', () => {
    const projectOnly = searchIndex(index, 'ProjectId').find(m => m.doc.kind === 'mappingBinding');
    expect(projectOnly?.doc.definition).toBe('Project invoice [InvoiceProject]');
  });
});

describe('excerptAround', () => {
  it('cuts long expressions around the match', () => {
    const text = `${'a'.repeat(100)}NEEDLE${'b'.repeat(100)}`;
    const excerpt = excerptAround(text, 'needle', 10);
    expect(excerpt).toBe(`…${'a'.repeat(10)}NEEDLE${'b'.repeat(10)}…`);
  });
});
