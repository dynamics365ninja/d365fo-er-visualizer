import { describe, expect, it } from 'vitest';
import { getDrillDownEffectiveResolutionInput } from './DrillDownPanel';

describe('getDrillDownEffectiveResolutionInput', () => {
  it('keeps selected non-model expression even when mapping context exists', () => {
    const result = getDrillDownEffectiveResolutionInput({
      selectedExpression: "'001_System'.'$TaxJuristictionUIP'",
      selectedIsModel: false,
      frameConfigIndex: 5,
      modelBindingExpression: "'001_System'.TaxTransactionLines",
      modelBindingConfigIndex: 2,
    });

    expect(result).toEqual({
      effectiveExpr: "'001_System'.'$TaxJuristictionUIP'",
      effectiveCi: 5,
    });
  });

  it('uses resolved model binding for model expression', () => {
    const result = getDrillDownEffectiveResolutionInput({
      selectedExpression: 'model.TaxTransactions.Values.TaxAmount',
      selectedIsModel: true,
      frameConfigIndex: 1,
      modelBindingExpression: "ReportFields.'$PurchaseVATDeductionAdjustStandardAmount'",
      modelBindingConfigIndex: 3,
    });

    expect(result).toEqual({
      effectiveExpr: "ReportFields.'$PurchaseVATDeductionAdjustStandardAmount'",
      effectiveCi: 3,
    });
  });

  it('falls back to selected expression when model binding is unavailable', () => {
    const result = getDrillDownEffectiveResolutionInput({
      selectedExpression: 'model.Unknown.Path',
      selectedIsModel: true,
      frameConfigIndex: 4,
    });

    expect(result).toEqual({
      effectiveExpr: 'model.Unknown.Path',
      effectiveCi: 4,
    });
  });
});

import { tokenizeERExpr } from './DrillDownPanel';

describe('tokenizeERExpr label references', () => {
  it('tokenizes the quoted form as a single label token', () => {
    const tokens = tokenizeERExpr('@"GER_LABEL:Foo"');
    expect(tokens).toEqual([{ kind: 'label', raw: '@"GER_LABEL:Foo"' }]);
  });

  it('tokenizes the bare form as a label instead of a datasource', () => {
    const tokens = tokenizeERExpr('CONCATENATE(@GER_LABEL:Foo, " ", @SYS12345)');
    const labels = tokens.filter(tk => tk.kind === 'label').map(tk => tk.raw);
    expect(labels).toEqual(['@GER_LABEL:Foo', '@SYS12345']);
    expect(tokens.some(tk => tk.kind === 'ds' && tk.raw === 'GER_LABEL')).toBe(false);
  });

  it('keeps the current-record reference intact', () => {
    const tokens = tokenizeERExpr('@.Amount');
    expect(tokens).toEqual([{ kind: 'other', raw: '@.Amount' }]);
  });
});

import { shouldShowFullExpression } from './DrillDownPanel';

describe('shouldShowFullExpression', () => {
  it('shows the card for a bare label reference', () => {
    // The card is the only place ExpressionView translates labels, so hiding it
    // left a lone @"GER_LABEL:Foo" rendered as a raw id.
    expect(shouldShowFullExpression('@"GER_LABEL:Foo"')).toBe(true);
    expect(shouldShowFullExpression('@GER_LABEL:Foo')).toBe(true);
  });

  it('still shows the card for functions and compound expressions', () => {
    expect(shouldShowFullExpression('CONCATENATE(@GER_LABEL:Foo, " ")')).toBe(true);
    expect(shouldShowFullExpression('model.Amount <> ""')).toBe(true);
  });

  it('hides the card for a bare path already covered by the breadcrumb', () => {
    expect(shouldShowFullExpression("'001_System'.TaxTransactionLines")).toBe(false);
    expect(shouldShowFullExpression('model.Invoice.Amount')).toBe(false);
  });
});
