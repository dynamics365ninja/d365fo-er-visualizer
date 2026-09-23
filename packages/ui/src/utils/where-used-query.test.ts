import { describe, expect, it } from 'vitest';
import { whereUsedQueryFor } from './where-used-query';
import { clampSplitRatio } from './split-ratio';

describe('where used from a node', () => {
  it('searches a datasource by its own name', () => {
    expect(whereUsedQueryFor({ type: 'datasource', name: 'Tables / CustTable', data: { name: 'CustTable' } })).toBe('CustTable');
  });
  it('searches model fields, records and enums by name', () => {
    expect(whereUsedQueryFor({ type: 'field', name: 'InvoiceDate' })).toBe('InvoiceDate');
    expect(whereUsedQueryFor({ type: 'container', name: 'Invoice' })).toBe('Invoice');
    expect(whereUsedQueryFor({ type: 'enum', name: 'NoYes' })).toBe('NoYes');
  });
  it('does not apply to format elements or configurations', () => {
    expect(whereUsedQueryFor({ type: 'formatElement', name: 'Amount' })).toBeNull();
    expect(whereUsedQueryFor({ type: 'file', name: 'Sales invoice' })).toBeNull();
  });
});

describe('split ratio', () => {
  it('keeps both groups readable', () => {
    expect(clampSplitRatio(0.05)).toBe(0.2);
    expect(clampSplitRatio(0.95)).toBe(0.8);
    expect(clampSplitRatio(Number.NaN)).toBe(0.5);
  });
});
