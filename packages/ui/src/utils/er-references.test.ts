import { describe, expect, it } from 'vitest';
import { constantValue, extractReferences, isBarePath, parseFunctionCall, substituteCurrent } from './er-references';

const paths = (expr: string) => extractReferences(expr).map(ref => (ref.current ? ['@', ...ref.segments.slice(1)] : ref.segments).join('.'));

describe('extractReferences', () => {
  it('reads plain and quoted paths', () => {
    expect(paths("model.InvoiceBase.Lines")).toEqual(['model.InvoiceBase.Lines']);
    expect(paths("'$Invoice'.InvoiceId")).toEqual(['$Invoice.InvoiceId']);
    expect(paths("'Sales invoice'.'Customer''s name'")).toEqual(["Sales invoice.Customer's name"]);
  });

  it('skips function names, literals, numbers and label references', () => {
    expect(paths('ROUND($Invoice.InvoiceAmount, 2)')).toEqual(['$Invoice.InvoiceAmount']);
    expect(paths('CONCATENATE("INV_", model.Id, ".xml")')).toEqual(['model.Id']);
    expect(paths('IF(x.IsSet, @"GER_LABEL:Yes", @SYS12345)')).toEqual(['x.IsSet']);
    expect(paths('"file.xml"')).toEqual([]);
    expect(paths('1.5 * Rate')).toEqual(['Rate']);
  });

  it('marks current-record paths', () => {
    const [ref] = extractReferences('@.Qty * 2');
    expect(ref.current).toBe(true);
    expect(ref.segments).toEqual(['@', 'Qty']);
  });

  it('keeps method calls as segments and searches their arguments', () => {
    expect(paths('$Company.postalAddress().City')).toEqual(['$Company.postalAddress().City']);
    expect(paths('ProjTable.find(ProjInvoiceJour.ProjId).Name')).toEqual(['ProjInvoiceJour.ProjId', 'ProjTable.find().Name']);
  });

  it('ignores fields read on an unnamed result and boolean keywords', () => {
    expect(paths('FIRSTORNULL(WHERE(T, T.Id = P.Id)).Name')).toEqual(['T', 'T.Id', 'P.Id']);
    expect(paths('a.b AND NOT(c) OR true')).toEqual(['a.b', 'c']);
  });

  it('reports offsets of each path', () => {
    const [ref] = extractReferences('ROUND(x.y, 2)');
    expect(ref.start).toBe(6);
    expect(ref.end).toBe(9);
  });
});

describe('parseFunctionCall', () => {
  it('splits top-level arguments only', () => {
    expect(parseFunctionCall('ORDERBY(WHERE(T, T.A = "x,y"), T.B)')).toEqual({ name: 'ORDERBY', args: ['WHERE(T, T.A = "x,y")', 'T.B'] });
  });

  it('is null when the call is only part of the expression', () => {
    expect(parseFunctionCall('ROUND(a, 2) + 1')).toBeNull();
    expect(parseFunctionCall('model.A')).toBeNull();
  });
});

describe('constantValue / isBarePath', () => {
  it('recognises literals', () => {
    expect(constantValue('"A ""quoted"" text"')).toBe('A "quoted" text');
    expect(constantValue('42')).toBe('42');
    expect(constantValue('TRUE')).toBe('true');
    expect(constantValue('model.A')).toBeNull();
  });

  it('recognises bare paths', () => {
    expect(isBarePath("model.Invoice.'$Date'")).toBe(true);
    expect(isBarePath('@.Qty')).toBe(true);
    expect(isBarePath('ROUND(a, 2)')).toBe(false);
    expect(isBarePath('a.b + c')).toBe(false);
    expect(isBarePath('x.find()')).toBe(false);
  });
});

describe('substituteCurrent', () => {
  it('spells out @ as the list path', () => {
    expect(substituteCurrent('@.Qty * @.Price', 'model.Lines')).toBe('model.Lines.Qty * model.Lines.Price');
    expect(substituteCurrent('@"GER_LABEL:X"', 'model.Lines')).toBe('@"GER_LABEL:X"');
  });
});
