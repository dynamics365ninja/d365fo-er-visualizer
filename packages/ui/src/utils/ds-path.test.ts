import { describe, it, expect } from 'vitest';
import { dsPathToExpression, quotePathSegment } from './ds-path';

describe('quotePathSegment', () => {
  it('leaves a plain identifier bare', () => {
    expect(quotePathSegment('grouped')).toBe('grouped');
  });

  it('quotes names with spaces and $ prefixes', () => {
    expect(quotePathSegment('Control statement')).toBe("'Control statement'");
    expect(quotePathSegment('$A1Trans')).toBe("'$A1Trans'");
  });

  it('keeps an already quoted segment as it is', () => {
    expect(quotePathSegment("'Control statement'")).toBe("'Control statement'");
  });

  it('drops blanks', () => {
    expect(quotePathSegment('   ')).toBe('');
  });
});

describe('dsPathToExpression', () => {
  it('converts a group-by list path', () => {
    expect(dsPathToExpression('Control statement/$A1Trans')).toBe("'Control statement'.'$A1Trans'");
  });

  it('quotes every segment that needs it, deep paths included', () => {
    expect(dsPathToExpression('Sales invoice/Lines/$Tax amount'))
      .toBe("'Sales invoice'.Lines.'$Tax amount'");
  });

  it('handles dotted input as well as slashed', () => {
    expect(dsPathToExpression('Tables.$CustInvoiceJour')).toBe("Tables.'$CustInvoiceJour'");
  });

  it('leaves an expression that is already quoted alone', () => {
    expect(dsPathToExpression("'Control statement'.'$A1Trans'")).toBe("'Control statement'.'$A1Trans'");
  });

  it('survives empty input', () => {
    expect(dsPathToExpression('')).toBe('');
    expect(dsPathToExpression(undefined as unknown as string)).toBe('');
  });
});
