import { describe, expect, it } from 'vitest';
import { currentRecordFor, expandBindingCurrentRecord } from './expression-resolution';

const bindings = [
  { path: 'Invoice/Lines', expressionAsString: '$Lines' },
  { path: 'Invoice/Lines/ItemId', expressionAsString: '@.ItemId' },
  { path: 'Invoice/Lines/Dims', expressionAsString: '@.Dimensions' },
  { path: 'Invoice/Lines/Dims/Value', expressionAsString: '@.DisplayValue' },
  { path: 'Invoice/Tax', expressionAsString: 'WHERE(TaxTrans, TaxTrans.Ok)' },
  { path: 'Invoice/Tax/Code', expressionAsString: '@.TaxCode' },
];

describe('currentRecordFor', () => {
  it('is the expression of the nearest bound ancestor', () => {
    expect(currentRecordFor('Invoice/Lines/ItemId', bindings)).toBe('$Lines');
  });

  it('expands a nested @ list', () => {
    expect(currentRecordFor('Invoice/Lines/Dims/Value', bindings)).toBe('$Lines.Dimensions');
    expect(expandBindingCurrentRecord('Invoice/Lines/Dims/Value', '@.DisplayValue', bindings)).toBe('$Lines.Dimensions.DisplayValue');
  });

  it('gives up on a list that is not a plain path', () => {
    expect(currentRecordFor('Invoice/Tax/Code', bindings)).toBeUndefined();
    expect(expandBindingCurrentRecord('Invoice/Tax/Code', '@.TaxCode', bindings)).toBe('@.TaxCode');
  });
});
