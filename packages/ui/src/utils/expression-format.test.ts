import { describe, expect, it } from 'vitest';
import { parseExpressionSegments } from './path-tooltip';
import { diffFormulaLines, formatFormula, type FormulaLine } from './expression-format';

const text = (lines: FormulaLine[]) => lines.map(line => `${'  '.repeat(line.indent)}${line.text}`);

describe('formatFormula', () => {
  it('keeps a short formula on one line, with the spacing normalised', () => {
    expect(text(formatFormula('ROUND( $Invoice.InvoiceAmount ,2 )'))).toEqual(['ROUND($Invoice.InvoiceAmount, 2)']);
    expect(text(formatFormula('  model.InvoiceBase.Lines  '))).toEqual(['model.InvoiceBase.Lines']);
    expect(text(formatFormula(''))).toEqual(['']);
  });

  it('puts the arguments of a long call on lines of their own, short calls stay inline', () => {
    const formula = 'IF(model.InvoiceBase.CompanyInfo.VATNum <> "", CONCATENATE("CZ", model.InvoiceBase.CompanyInfo.VATNum), FIRSTORNULL(WHERE(CompanyInfo, CompanyInfo.DataArea = @.Company)).VATNum)';
    expect(text(formatFormula(formula))).toEqual([
      'IF(',
      '  model.InvoiceBase.CompanyInfo.VATNum <> "",',
      '  CONCATENATE("CZ", model.InvoiceBase.CompanyInfo.VATNum),',
      '  FIRSTORNULL(',
      '    WHERE(CompanyInfo, CompanyInfo.DataArea = @.Company)',
      '  ).VATNum',
      ')',
    ]);
  });

  it('never breaks inside a string literal or a quoted name', () => {
    const formula = 'CONCATENATE("a, (b)", \'x, y\'.\'z()\', "c"" , d", model.InvoiceBase.CompanyInfo.Name, model.InvoiceBase.InvoiceId)';
    const lines = formatFormula(formula);
    expect(lines.map(l => l.text)).toEqual([
      'CONCATENATE(',
      '"a, (b)",',
      '\'x, y\'.\'z()\',',
      '"c"" , d",',
      'model.InvoiceBase.CompanyInfo.Name,',
      'model.InvoiceBase.InvoiceId',
      ')',
    ]);
  });

  it('keeps a space before a parenthesis that is no call', () => {
    expect(formatFormula('a AND (b OR c)')[0].text).toBe('a AND (b OR c)');
  });

  it('closes what an unbalanced formula opened instead of losing text', () => {
    expect(formatFormula('ROUND(x, 2').map(l => l.text).join('')).toBe('ROUND(x, 2)');
  });

  it('cuts lines so each one tokenizes like the same text inside the whole formula', () => {
    const formula = 'WHERE(CustInvoiceTrans, AND(CustInvoiceTrans.InvoiceId = $Invoice.InvoiceId, CustInvoiceTrans.Qty > 0, NOT(ISEMPTY(CustInvoiceTrans.ItemId))))';
    const whole = parseExpressionSegments(formula, 'binding-expr').filter(s => s.chain).map(s => s.chain!.join('.'));
    const perLine = formatFormula(formula).flatMap(l => parseExpressionSegments(l.text, 'binding-expr').filter(s => s.chain).map(s => s.chain!.join('.')));
    expect(perLine).toEqual(whole);
  });
});

describe('diffFormulaLines', () => {
  const lines = (...texts: string[]) => texts.map(t => ({ indent: t.length - t.trimStart().length, text: t.trim() }));

  it('faces the shared lines and pairs the lines in between as changed', () => {
    const rows = diffFormulaLines(lines('IF(', ' a,', ' ROUND(x, 2),', ' c', ')'), lines('IF(', ' a,', ' ROUND(x, 3),', ' c', ')'));
    expect(rows.map(r => r.kind)).toEqual(['same', 'same', 'changed', 'same', 'same']);
    expect(rows[2].change).toEqual({ prefix: 'ROUND(x, ', before: '2', after: '3', suffix: '),' });
  });

  it('reports lines only one side has as removed or added', () => {
    const rows = diffFormulaLines(lines('IF(', ' a,', ' b', ')'), lines('IF(', ' a,', ' x,', ' y,', ' b', ')'));
    expect(rows.map(r => r.kind)).toEqual(['same', 'same', 'added', 'added', 'same', 'same']);
    const gone = diffFormulaLines(lines('a', 'b'), lines('b'));
    expect(gone.map(r => r.kind)).toEqual(['removed', 'same']);
  });

  it('marks a line that only moved deeper as changed', () => {
    const rows = diffFormulaLines(lines('a'), lines(' a'));
    expect(rows).toEqual([{ kind: 'changed', before: { indent: 0, text: 'a' }, after: { indent: 1, text: 'a' } }]);
  });
});
