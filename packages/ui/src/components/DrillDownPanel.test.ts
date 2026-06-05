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
