import { describe, expect, it } from 'vitest';
import { formatSampleDate, formatSampleNumber, layoutFixed, sampleValue } from './sample-values';

describe('formatSampleNumber', () => {
  it('follows the mask', () => {
    expect(formatSampleNumber(1234.5, '0.00')).toBe('1234.50');
    expect(formatSampleNumber(2, '0.###')).toBe('2');
    expect(formatSampleNumber(2.125, '0.###')).toBe('2.125');
    expect(formatSampleNumber(42, '000000')).toBe('000042');
    expect(formatSampleNumber(1234567.8, '#,##0.00')).toBe('1 234 567.80');
  });
});

describe('formatSampleDate', () => {
  it('writes the date in the format the element asks for', () => {
    const date = new Date(2026, 2, 31, 10, 5);
    expect(formatSampleDate(date, 'yyyy-MM-dd', false)).toBe('2026-03-31');
    expect(formatSampleDate(date, 'ddMMyy', false)).toBe('310326');
    expect(formatSampleDate(date, undefined, true)).toBe('2026-03-31T10:05:00');
  });
});

describe('sampleValue', () => {
  const base = { dataType: 'String', constraints: {}, seed: 'x', iteration: 0 };

  it('reads the meaning from the names', () => {
    expect(sampleValue({ ...base, names: ['IBAN'] })).toMatch(/^[A-Z]{2}\d+/);
    expect(sampleValue({ ...base, names: ['CurrencyCode'] })).toMatch(/^(CZK|EUR)$/);
    expect(sampleValue({ ...base, names: ['InvoiceId', 'InvoiceNumber'] })).toMatch(/^INV-2026-\d{4}$/);
  });

  it('uses enum values when the field is an enum', () => {
    expect(['Cash', 'BankTransfer']).toContain(sampleValue({ ...base, names: ['PaymentMethod'], enumValues: ['Cash', 'BankTransfer'] }));
  });

  it('respects the maximum length and the number format', () => {
    expect(sampleValue({ ...base, names: ['Description'], constraints: { maxLength: 5 } }).length).toBeLessThanOrEqual(5);
    expect(sampleValue({ ...base, dataType: 'Real', names: ['LineAmount'], constraints: { format: '0.00' } })).toMatch(/^\d+\.\d{2}$/);
  });

  it('takes the shape of the formula that computes the value', () => {
    const formula = (f: string, seed = 'x') => sampleValue({ ...base, names: ['Code'], formula: f, seed });
    expect(['B', 'O', 'N']).toContain(formula('CASE(Parameters.Type, Types.Regular, "B", Types.Corrective, "O", Types.Supplementary, "N", "")'));
    expect(['A', 'N']).toContain(formula('IF(model.IsBadDebt, "A", "N")'));
    expect(formula('DATEFORMAT(model.ToDate, "yyyy")')).toBe('2026');
    expect(formula('IF(model.Monthly, DATEFORMAT(model.ToDate, "MM"), "")')).toMatch(/^\d{2}$/);
    expect(formula('SUMIF("Base", "Lines", "Values") + SUMIF("Base", "Other", "Values")')).toMatch(/^\d+\.\d{2}$/);
    // A formula that only passes data on leaves it to the names.
    expect(formula('model.Header.Code')).toMatch(/^(A01|STD|VAT21)$/);
  });

  it('makes up text of its own rather than repeating the field name', () => {
    const values = ['a', 'b', 'c', 'd'].map(seed => sampleValue({ ...base, names: ['Remark'], seed }));
    expect(values.some(value => /remark/i.test(value))).toBe(false);
    expect(new Set(values).size).toBeGreaterThan(1);
    expect(sampleValue({ ...base, names: ['Remark'], constraints: { maxLength: 4 } })).toMatch(/^[A-Z]{4}$/);
  });

  it('writes amounts with two decimals', () => {
    expect(sampleValue({ ...base, dataType: 'Real', names: ['TaxBaseAmountCur'], modelType: 5 })).toMatch(/^\d+\.\d{2}$/);
  });

  it('varies with the record number', () => {
    const a = sampleValue({ ...base, dataType: 'Real', names: ['LineNum'], iteration: 0 });
    const b = sampleValue({ ...base, dataType: 'Real', names: ['LineNum'], iteration: 1 });
    expect([a, b]).toEqual(['1', '2']);
  });
});

describe('layoutFixed', () => {
  it('pads to the fixed width on the aligned side', () => {
    expect(layoutFixed('123', { minLength: 6, maxLength: 6, padding: '0', alignment: 'Right' })).toEqual({ text: '123', padding: '000', padLeft: true });
    expect(layoutFixed('AB', { minLength: 4 })).toEqual({ text: 'AB', padding: '  ', padLeft: false });
    expect(layoutFixed('ABCDEFG', { maxLength: 4 }).text).toBe('ABCD');
  });
});
