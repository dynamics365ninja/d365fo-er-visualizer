import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { buildFormatLineage, specificationRows } from './format-lineage';
import { invoiceWorkspace } from './invoice-workspace.test-fixture';
import { traceSteps } from './trace-steps';

const configs = invoiceWorkspace();
const lineage = buildFormatLineage(configs, 2)!;
const row = (name: string) => specificationRows(lineage).find(r => r.displayName === name)!;
const shape = (name: string, mappingLoaded = true) =>
  traceSteps(row(name), mappingLoaded).map(step => [step.kind, step.text]);

describe('traceSteps', () => {
  it('walks a model-bound field through the mapping to the table field', () => {
    expect(shape('InvoiceNumber')).toEqual([
      ['format', 'InvoiceNumber'],
      ['model', 'InvoiceBase/InvoiceId'],
      ['mapping', '$Invoice.InvoiceId'],
      ['source', 'CustInvoiceJour.InvoiceId'],
    ]);
    expect(traceSteps(row('InvoiceNumber'), true).at(-1)?.label).toBe(t.sourceKindLabels.field);
  });

  it('resolves @ inside a repeating element to the field of the list', () => {
    const steps = shape('ItemId');
    expect(steps[1]).toEqual(['model', 'InvoiceBase/Lines/ItemId']);
    expect(steps.at(-1)).toEqual(['source', 'CustInvoiceTrans.ItemId']);
  });

  it('ends on the value of a constant', () => {
    expect(shape('version')).toEqual([['format', 'version'], ['value', '1.0']]);
  });

  it('marks an unbound element as a gap', () => {
    const steps = traceSteps(row('BIC'), true);
    expect(steps.map(step => step.kind)).toEqual(['format', 'gap']);
    expect(steps[1].label).toBe(t.fillKindLabels.unbound);
  });

  it('says when the mapping that would fill the field is not loaded', () => {
    const fill = row('InvoiceNumber');
    const unmapped = { ...fill, modelLinks: fill.modelLinks.map(link => ({ ...link, fill: null })), sources: [] };
    expect(traceSteps(unmapped, false).map(step => [step.kind, step.text])).toEqual([
      ['format', 'InvoiceNumber'],
      ['model', 'InvoiceBase/InvoiceId'],
      ['gap', t.traceMappingMissing],
    ]);
    expect(traceSteps(unmapped, true)[2].text).toBe(t.specUnmapped);
  });
});
