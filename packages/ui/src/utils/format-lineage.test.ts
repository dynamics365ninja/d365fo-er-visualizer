import { describe, expect, it } from 'vitest';
import { buildFormatLineage, buildMappingLineage, primaryValueSources, specificationRows } from './format-lineage';
import { invoiceWorkspace } from './invoice-workspace.test-fixture';
import type { ERModelMappingContent } from '@er-visualizer/core';

const configs = invoiceWorkspace();
const lineage = buildFormatLineage(configs, 2)!;
const row = (name: string) => specificationRows(lineage).find(r => r.displayName === name)!;
const names = (sources: Array<{ name: string }>) => sources.map(s => s.name);

describe('buildMappingLineage', () => {
  const mapping = (configs[1].content as ERModelMappingContent).version.mappings[0];
  const lineageOf = buildMappingLineage(mapping, 1);

  it('traces a calculated record to the table field', () => {
    const fill = lineageOf.resolve(['InvoiceBase', 'InvoiceId'])!;
    expect(fill.expression).toBe('$Invoice.InvoiceId');
    expect(names(primaryValueSources(fill))).toEqual(['CustInvoiceJour.InvoiceId']);
    // The filter of the record and the parameter it compares with are context.
    const context = fill.sources.filter(s => s.role === 'context').map(s => s.name);
    expect(context).toEqual(expect.arrayContaining(['Parameters']));
  });

  it('resolves @ against the bound list above', () => {
    const fill = lineageOf.resolve(['InvoiceBase', 'Lines', 'ItemId'])!;
    expect(names(primaryValueSources(fill))).toEqual(['CustInvoiceTrans.ItemId']);
    expect(fill.sources.find(s => s.name === '$Lines')?.role).toBe('context');
  });

  it('follows a table find() and group-by aggregations', () => {
    expect(names(primaryValueSources(lineageOf.resolve(['InvoiceBase', 'CompanyInfo', 'Name'])!))).toEqual(['CompanyInfo.Name']);
    const tax = lineageOf.resolve(['InvoiceBase', 'TaxSummary', 'TaxAmount'])!;
    expect(names(primaryValueSources(tax))).toEqual(['TaxTrans.TaxAmount']);
  });

  it('reports enums used in a mapping formula', () => {
    const fill = lineageOf.resolve(['InvoiceBase', 'PaymentMethod'])!;
    expect(fill.sources.some(s => s.kind === 'enum' && s.name === 'CustPaymMode')).toBe(true);
  });

  it('is null for a path nothing binds', () => {
    expect(lineageOf.resolve(['InvoiceBase', 'Notes'])).toBeNull();
  });
});

describe('buildFormatLineage', () => {
  it('picks the mapping definition for the format descriptor', () => {
    expect(lineage.mapping?.label).toBe('Customer invoice [InvoiceCustomer]');
    expect(lineage.context.dataModel).not.toBeNull();
  });

  it('merges the unnamed value node into its XML element', () => {
    const invoiceNumber = row('InvoiceNumber');
    expect(invoiceNumber.binding).toBe('model.InvoiceBase.InvoiceId');
    expect(invoiceNumber.fill).toBe('model');
    expect(invoiceNumber.isField).toBe(true);
    expect(invoiceNumber.dataType).toBe('String');
    expect(invoiceNumber.constraints).toMatchObject({ maxLength: 20, minLength: 1 });
    expect(names(primaryValueSources(invoiceNumber))).toEqual(['CustInvoiceJour.InvoiceId']);
    expect(specificationRows(lineage).some(r => r.displayName === 'String')).toBe(false);
  });

  it('resolves @ inside a repeating element down to the table field', () => {
    const line = row('Line');
    expect(line.repeating).toBe(true);
    expect(line.repeatInferred).toBeUndefined();
    const itemId = row('ItemId');
    expect(itemId.modelLinks.find(l => l.role === 'value')?.path).toBe('InvoiceBase/Lines/ItemId');
    expect(names(primaryValueSources(itemId))).toEqual(['CustInvoiceTrans.ItemId']);
    expect(itemId.depth).toBe(line.depth + 1);
  });

  it('classifies constants, calculations, unbound fields and conditions', () => {
    expect(row('version').fill).toBe('constant');
    expect(row('version').constant).toBe('1.0');
    expect(row('Total').fill).toBe('calculated');
    expect(row('BIC').fill).toBe('unbound');
    const note = row('Note');
    expect(note.conditions).toEqual(['model.InvoiceBase.Notes <> ""']);
    expect(note.optional).toBe(true);
  });

  it('reads through a calculated field of the format to the model', () => {
    const gross = row('Gross');
    expect(gross.fill).toBe('datasource');
    expect(gross.formatSources.some(s => s.name === '$Gross')).toBe(true);
    expect(gross.modelLinks.map(l => l.path)).toContain('InvoiceBase/InvoiceAmount');
    expect(names(primaryValueSources(gross))).toEqual(['CustInvoiceJour.InvoiceAmount']);
  });

  it('keeps property bindings such as FileName apart', () => {
    const file = lineage.elements[0];
    expect(file.otherBindings).toEqual([{ property: 'FileName', expression: 'CONCATENATE("INV_", model.InvoiceBase.InvoiceId)' }]);
  });

  it('counts fields by how they are filled', () => {
    expect(lineage.stats).toMatchObject({ unbound: 1, constant: 1, calculated: 1, repeating: 2, conditional: 1 });
  });

  it('reads text delimiters and line ends', () => {
    const csv = buildFormatLineage(configs, 3)!;
    const line = specificationRows(csv).find(r => r.displayName === 'Line')!;
    expect(line.constraints).toMatchObject({ delimiter: ';', lineEnd: 'CR LF' });
    expect(line.repeating).toBe(true);
  });
});
