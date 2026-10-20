import { describe, expect, it } from 'vitest';
import type { ERDatasource } from '@er-visualizer/core';
import { traceExpression, type TraceScope } from './datasource-lineage';

const table = (name: string, tableName: string): ERDatasource => ({ name, type: 'Table', children: [], tableInfo: { tableName, selectedFields: [] } });
const calc = (name: string, formula: string, children: ERDatasource[] = [], parentPath?: string): ERDatasource =>
  ({ name, type: 'CalculatedField', parentPath, children, calculatedField: { expressionAsString: formula } });

// The shape of a tax declaration: transactions filtered by company, lists of
// them joined and grouped, values declared on each list.
const pool: ERDatasource[] = [
  table('Trans', 'TaxTrans'),
  table('Company', 'CompanyInfo'),
  table('Params', 'TaxParameters'),
  table('Party', 'DirPartyTable'),
  calc('$Sales', 'FILTER(Trans, Trans.dataAreaId = Company.DataArea)', [
    { name: 'Values', type: 'Container', implicit: true, parentPath: '$Sales', children: [calc('$Base', "'$Sales'.TaxBaseAmount", [], '$Sales/Values')] },
  ]),
  calc('$Purch', 'FILTER(Trans, Trans.Direction = 2)', [
    { name: 'Values', type: 'Container', implicit: true, parentPath: '$Purch', children: [calc('$Base', "'$Purch'.DeductibleTaxBaseAmount", [], '$Purch/Values')] },
  ]),
  calc('$All', "LISTJOIN('$Sales', '$Purch')"),
  {
    name: '$Docs', type: 'GroupBy', children: [],
    groupByInfo: {
      listToGroup: '$Sales',
      groupedFields: [{ name: 'Voucher', path: '$Sales/Voucher' }],
      aggregations: [{ name: 'TaxBase', path: '$Sales/TaxBaseAmount', function: 'SUM' }],
    },
  },
  { name: '$Joined', type: 'Join', children: [], joinInfo: { lists: [{ name: '$Trans', path: '$Sales' }, { name: '$Party', path: 'Party' }] } },
];
const scope: TraceScope = { pool, configIndex: 0 };
const fields = (expr: string, role: 'value' | 'context') =>
  traceExpression(expr, scope).sources.filter(s => s.kind === 'field' && s.role === role).map(s => s.name).sort();

describe('traceExpression', () => {
  it('reads a grouped field off the records being grouped; the grouped list only picks them', () => {
    expect(fields("'$Docs'.grouped.Voucher", 'value')).toEqual(['TaxTrans.Voucher']);
    expect(fields("'$Docs'.grouped.Voucher", 'context')).toEqual(['CompanyInfo.DataArea', 'TaxTrans.dataAreaId']);
  });

  it('reads an aggregation off the field it aggregates', () => {
    expect(fields("'$Docs'.aggregated.TaxBase", 'value')).toEqual(['TaxTrans.TaxBaseAmount']);
  });

  it('reads a joined record off the list it names', () => {
    expect(fields("'$Joined'.'$Party'.Name", 'value')).toEqual(['DirPartyTable.Name']);
  });

  it('reads a field of joined lists on each list, where each declares it', () => {
    expect(fields("'$All'.Values.'$Base'", 'value')).toEqual(['TaxTrans.DeductibleTaxBaseAmount', 'TaxTrans.TaxBaseAmount']);
  });

  it('takes the test of an IF as context when the results read data of their own', () => {
    const expr = "IF(Params.UseVatDueDate, '$Sales'.VatDueDate, '$Sales'.TransDate)";
    expect(fields(expr, 'value')).toEqual(['TaxTrans.TransDate', 'TaxTrans.VatDueDate']);
    expect(fields(expr, 'context')).toContain('TaxParameters.UseVatDueDate');
    // With literal results the test is the value.
    expect(fields('IF(Params.UseVatDueDate, "A", "N")', 'value')).toEqual(['TaxParameters.UseVatDueDate']);
  });
});
