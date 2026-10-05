import { describe, expect, it } from 'vitest';
import { erFunctionDocUrl } from './er-function-docs';
import { tokenizeERExpr } from '../components/DrillDownPanel';

describe('erFunctionDocUrl', () => {
  it('links a function to its Learn article, case-insensitively', () => {
    expect(erFunctionDocUrl('if')).toBe(
      'https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/analytics/er-functions-logical-if',
    );
    expect(erFunctionDocUrl('ListJoin', 'cs')).toBe(
      'https://learn.microsoft.com/cs-cz/dynamics365/fin-ops-core/dev-itpro/analytics/er-functions-list-listjoin',
    );
  });

  it('returns nothing for functions Learn does not document', () => {
    expect(erFunctionDocUrl('SUM')).toBeUndefined();
  });
});

describe('tokenizeERExpr function detection', () => {
  it('treats a documented function as a function only when it is called', () => {
    const called = tokenizeERExpr('PADLEFT(model.Code, 10, "0")');
    expect(called[0]).toMatchObject({ kind: 'func', raw: 'PADLEFT' });

    const datasource = tokenizeERExpr('List.Name');
    expect(datasource[0]).toMatchObject({ kind: 'ds', segments: ['List', 'Name'] });
  });
});
