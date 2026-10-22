import { describe, expect, it } from 'vitest';
import { parseXlsxBase64, type XlsxWorkbook } from './xlsx-parser';
import { compareWorkbooks, isWorkbookTemplate } from './template-diff';
import { alignSequences, textSimilarity } from './sequence-diff';
import { buildWorkbookBase64, FIXTURE_STYLE, type FixtureWorkbook } from './xlsx-workbook.test-fixture';

async function workbook(spec: FixtureWorkbook): Promise<XlsxWorkbook> {
  return parseXlsxBase64(await buildWorkbookBase64(spec));
}

const BASE: FixtureWorkbook = {
  sheets: [{
    name: 'Invoice',
    cells: {
      A1: { v: 'Invoice', s: FIXTURE_STYLE.bold },
      A2: 'Customer', B2: '',
      A3: 'Date', B3: '',
      A5: 'Item', B5: 'Qty', C5: 'Amount',
      A7: 'Total', C7: { v: '0', f: 'SUM(C6:C6)' },
    },
    merges: ['A1:C1'],
    cols: [[1, 1, 20], [2, 3, 12]],
  }],
  names: [
    { name: 'CustomerName', ref: 'Invoice!$B$2' },
    { name: 'InvoiceDate', ref: 'Invoice!$B$3' },
    { name: 'Lines', ref: 'Invoice!$A$6:$C$6' },
  ],
};

describe('alignSequences', () => {
  it('pairs equal items and reports the rest as removed or added', () => {
    const rows = alignSequences(['a', 'b', 'c'], ['a', 'x', 'b', 'c']);
    expect(rows.map(r => r.kind)).toEqual(['same', 'added', 'same', 'same']);
  });

  it('pairs a changed item with its edited twin when alike enough', () => {
    const a = ['<Name>Contoso</Name>', '<Total>10</Total>'];
    const b = ['<Name>Fabrikam</Name>', '<Total>10</Total>'];
    const rows = alignSequences(a, b, { similarity: (i, j) => textSimilarity(a[i], b[j]) });
    expect(rows.map(r => r.kind)).toEqual(['changed', 'same']);
  });

  it('keeps an inserted item apart from the changed one next to it', () => {
    const a = ['header', 'Contoso Ltd', 'footer'];
    const b = ['header', 'NEW LINE', 'Contoso Ltd.', 'footer'];
    const rows = alignSequences(a, b, { similarity: (i, j) => textSimilarity(a[i], b[j]) });
    expect(rows.map(r => r.kind)).toEqual(['same', 'added', 'changed', 'same']);
  });
});

describe('compareWorkbooks', () => {
  it('finds nothing in two identical workbooks', async () => {
    const result = compareWorkbooks(await workbook(BASE), await workbook(BASE));
    expect(result.sections).toEqual([]);
    expect(result.counts).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it('reports an edited cell text with its before and after value', async () => {
    const newer = structuredClone(BASE);
    newer.sheets[0].cells.A2 = 'Customer name';
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    const entries = result.sections.flatMap(s => s.entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ change: 'changed', itemKind: 'cell', path: 'Invoice/A2' });
    expect(entries[0].properties).toEqual([{ key: 'cellValue', before: 'Customer', after: 'Customer name' }]);
    expect(result.sheets[0].newerMarks.get('A2')).toBe('changed');
  });

  it('reports a style-only change as such', async () => {
    const newer = structuredClone(BASE);
    newer.sheets[0].cells.A5 = { v: 'Item', s: FIXTURE_STYLE.boldYellow };
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    const [entry] = result.sections.flatMap(s => s.entries);
    expect(entry.path).toBe('Invoice/A5');
    expect(entry.properties.map(p => p.key).sort()).toEqual(['style:bold', 'style:fill']);
    expect(entry.properties.find(p => p.key === 'style:fill')?.after).toBe('#FFFF00');
    expect(result.sheets[0].newerMarks.get('A5')).toBe('style');
  });

  it('treats a row inserted at the top as one added row, not every cell below as changed', async () => {
    const newer: FixtureWorkbook = {
      sheets: [{
        ...BASE.sheets[0],
        cells: {
          A1: { v: 'Invoice', s: FIXTURE_STYLE.bold },
          A2: 'Vendor', B2: 'Contoso',
          A3: 'Customer', B3: '',
          A4: 'Date', B4: '',
          A6: 'Item', B6: 'Qty', C6: 'Amount',
          A8: 'Total', C8: { v: '0', f: 'SUM(C7:C7)' },
        },
      }],
      names: [
        { name: 'CustomerName', ref: 'Invoice!$B$3' },
        { name: 'InvoiceDate', ref: 'Invoice!$B$4' },
        { name: 'Lines', ref: 'Invoice!$A$7:$C$7' },
      ],
    };
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    const entries = result.sections.flatMap(s => s.entries);
    // The new row's two cells, and the total's formula that now sums another row.
    expect(entries.map(e => `${e.change} ${e.path}`)).toEqual([
      'added Invoice/A2',
      'added Invoice/B2',
      'changed Invoice/C8',
    ]);
    expect(entries[2].previousPath).toBe('Invoice/C7');
    expect(entries[2].properties).toEqual([{ key: 'formula', before: 'SUM(C6:C6)', after: 'SUM(C7:C7)' }]);
    // Named ranges that moved down with the rows are not changes.
    expect(result.sections.some(s => s.kind === 'templateNames')).toBe(false);
    expect(result.sheets[0].olderToNewer.get(2)).toBe(3);
    expect(result.sheets[0].newerRowMarks.get(2)).toBe('added');
  });

  it('pairs a rewritten row by the named range ER writes through it', async () => {
    const newer = structuredClone(BASE);
    // A translation: no text in common, and a new row in between.
    newer.sheets[0].cells = { ...BASE.sheets[0].cells, A2: 'Odběratel', A3: 'Datum', A4: 'IČO' };
    newer.names = [...BASE.names!, { name: 'CompanyId', ref: 'Invoice!$B$4' }];
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    const cells = result.sections.find(s => s.kind === 'template')!.entries;
    expect(cells.map(e => `${e.change} ${e.path}`)).toEqual([
      'changed Invoice/A2',
      'changed Invoice/A3',
      'added Invoice/A4',
    ]);
  });

  it('keeps a different sheet at the same position apart from a renamed one', async () => {
    const newer: FixtureWorkbook = { sheets: [{ name: 'Summary', cells: { A1: 'Totals by month' } }] };
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    expect(result.sheets.map(s => `${s.change} ${s.name}`)).toEqual(['added Summary', 'removed Invoice']);
  });

  it('reports named ranges added, removed and pointed elsewhere', async () => {
    const newer = structuredClone(BASE);
    newer.names = [
      { name: 'CustomerName', ref: 'Invoice!$B$2:$C$2' },
      { name: 'Lines', ref: 'Invoice!$A$6:$C$6' },
      { name: 'TotalAmount', ref: 'Invoice!$C$7' },
    ];
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    const names = result.sections.find(s => s.kind === 'templateNames')!.entries;
    expect(names.map(e => `${e.change} ${e.path}`)).toEqual([
      'changed CUSTOMERNAME',
      'removed INVOICEDATE',
      'added TOTALAMOUNT',
    ]);
    expect(names[0].properties).toEqual([{ key: 'range', before: 'Invoice!B2', after: 'Invoice!B2:C2' }]);
  });

  it('reports merged cells, column widths and row heights', async () => {
    const newer = structuredClone(BASE);
    newer.sheets[0].merges = ['A1:D1'];
    newer.sheets[0].cols = [[1, 1, 24], [2, 3, 12]];
    newer.sheets[0].rowHeights = { 1: 30 };
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    const entries = result.sections.flatMap(s => s.entries);
    expect(entries.map(e => `${e.change} ${e.itemKind} ${e.path}`)).toEqual([
      'removed merge Invoice/A1:C1',
      'added merge Invoice/A1:D1',
      'changed layout Invoice',
    ]);
    const layout = entries[2].properties;
    expect(layout.find(p => p.key === 'columnWidths')).toMatchObject({ before: 'A = 20\nB = 12\nC = 12', after: 'A = 24\nB = 12\nC = 12' });
    expect(layout.find(p => p.key === 'rowHeights')).toMatchObject({ before: '1 = —', after: '1 = 30' });
  });

  it('pairs sheets by name, and a renamed sheet by its position', async () => {
    const newer: FixtureWorkbook = {
      sheets: [
        { ...BASE.sheets[0], name: 'Faktura' },
        { name: 'Notes', cells: { A1: 'Thank you' } },
      ],
      names: BASE.names?.map(n => ({ ...n, ref: n.ref.replace('Invoice!', 'Faktura!') })),
    };
    const result = compareWorkbooks(await workbook(BASE), await workbook(newer));
    expect(result.sheets.map(s => `${s.change} ${s.name}`)).toEqual(['changed Faktura', 'added Notes']);
    const entries = result.sections.flatMap(s => s.entries);
    expect(entries[0]).toMatchObject({ itemKind: 'sheet', change: 'changed', path: 'Faktura', previousPath: 'Invoice' });
    expect(entries[1]).toMatchObject({ itemKind: 'sheet', change: 'added', path: 'Notes' });
    // The ranges moved with their renamed sheet — not a change of their own.
    expect(result.sections.some(s => s.kind === 'templateNames')).toBe(false);
    expect(result.sheets[1].newerMarks.get('A1')).toBe('added');
  });
});

describe('isWorkbookTemplate', () => {
  it('recognises an embedded workbook by name or by its zip signature', () => {
    expect(isWorkbookTemplate({ filename: 'Invoice.xlsx', base64: 'UEsDBBQ=' })).toBe(true);
    expect(isWorkbookTemplate({ filename: 'Invoice', base64: 'UEsDBBQ=' })).toBe(true);
    expect(isWorkbookTemplate({ filename: 'Letter.docx', base64: 'UEsDBBQ=' })).toBe(false);
    expect(isWorkbookTemplate({ filename: 'Invoice.xlsx' })).toBe(false);
  });
});
