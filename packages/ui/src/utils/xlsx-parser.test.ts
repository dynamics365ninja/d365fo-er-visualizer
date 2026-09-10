/**
 * Unit tests for xlsx-parser.ts using the real "Free text invoice" Excel template
 * extracted from F&O via the integration test (scripts/fixtures/template.b64).
 *
 * To regenerate the fixture: pnpm run test:integration
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { parseXlsxBase64, type XlsxWorkbook, type XlsxCellStyle } from './xlsx-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../../../../scripts/fixtures/template.b64');

// Skip all tests gracefully if the fixture hasn't been generated yet.
const fixtureExists = existsSync(FIXTURE_PATH);
const describeOrSkip = fixtureExists ? describe : describe.skip;

describeOrSkip('xlsx-parser — Free text invoice template', () => {
  let workbook: XlsxWorkbook;
  let base64: string;

  beforeAll(async () => {
    base64 = readFileSync(FIXTURE_PATH, 'utf-8').trim();
    workbook = await parseXlsxBase64(base64);
  });

  // ── Basic structure ──────────────────────────────────────────────────────

  it('parses at least one sheet', () => {
    expect(workbook.sheets.length).toBeGreaterThan(0);
  });

  it('first sheet has a non-empty name', () => {
    expect(workbook.sheets[0]!.name).toBeTruthy();
  });

  it('first sheet has rows', () => {
    expect(workbook.sheets[0]!.rows.length).toBeGreaterThan(0);
  });

  it('first sheet has cells with values', () => {
    const allCells = workbook.sheets[0]!.rows.flatMap(r => r.cells);
    const nonEmpty = allCells.filter(c => c.value !== '');
    expect(nonEmpty.length).toBeGreaterThan(0);
  });

  // ── Styles ────────────────────────────────────────────────────────────────

  it('at least some cells have a styleIndex', () => {
    const allCells = workbook.sheets[0]!.rows.flatMap(r => r.cells);
    const styled = allCells.filter(c => c.styleIndex !== undefined);
    expect(styled.length).toBeGreaterThan(0);
  });

  it('cells with styleIndex also have a resolved style object', () => {
    const allCells = workbook.sheets[0]!.rows.flatMap(r => r.cells);
    const withStyleIdx = allCells.filter(c => c.styleIndex !== undefined);
    // Every cell that has a styleIndex should have a style object resolved.
    const missingStyle = withStyleIdx.filter(c => c.style === undefined);
    expect(missingStyle.length).toBe(0);
  });

  it('at least some cells have bold styling', () => {
    const allCells = workbook.sheets[0]!.rows.flatMap(r => r.cells);
    const bold = allCells.filter(c => c.style?.bold === true);
    expect(bold.length).toBeGreaterThan(0);
  });

  it('at least some cells have a non-default fill color', () => {
    const allCells = workbook.sheets.flatMap(s => s.rows).flatMap(r => r.cells);
    const colored = allCells.filter(c =>
      c.style?.fillType === 'solid' && (c.style.fgColor || c.style.bgColor),
    );
    expect(colored.length).toBeGreaterThan(0);
  });

  // ── parseStyles correctness ───────────────────────────────────────────────

  it('style objects only contain valid field types', () => {
    const allCells = workbook.sheets.flatMap(s => s.rows).flatMap(r => r.cells);
    for (const cell of allCells) {
      if (!cell.style) continue;
      const s = cell.style as Record<string, unknown>;
      if (s['bold']      !== undefined) expect(typeof s['bold']).toBe('boolean');
      if (s['italic']    !== undefined) expect(typeof s['italic']).toBe('boolean');
      if (s['underline'] !== undefined) expect(typeof s['underline']).toBe('boolean');
      if (s['fontSize']  !== undefined) expect(typeof s['fontSize']).toBe('number');
      if (s['fontColor'] !== undefined) expect(typeof s['fontColor']).toBe('string');
      if (s['fgColor']   !== undefined) expect(typeof s['fgColor']).toBe('string');
      if (s['fillType']  !== undefined) expect(typeof s['fillType']).toBe('string');
    }
  });

  // ── Merges ────────────────────────────────────────────────────────────────

  it('first sheet has merge regions', () => {
    expect(workbook.sheets[0]!.merges.length).toBeGreaterThan(0);
  });

  it('merge regions have valid coordinates', () => {
    for (const sheet of workbook.sheets) {
      for (const m of sheet.merges) {
        expect(m.startCol).toBeGreaterThan(0);
        expect(m.startRow).toBeGreaterThan(0);
        expect(m.endCol).toBeGreaterThanOrEqual(m.startCol);
        expect(m.endRow).toBeGreaterThanOrEqual(m.startRow);
      }
    }
  });

  // ── Column widths ─────────────────────────────────────────────────────────

  it('first sheet has column width data', () => {
    expect(workbook.sheets[0]!.colWidths.size).toBeGreaterThan(0);
  });

  // ── Snapshot: style distribution summary (informational) ─────────────────

  it('logs style distribution for inspection', () => {
    const allCells = workbook.sheets.flatMap(s => s.rows).flatMap(r => r.cells);
    const stats = {
      total: allCells.length,
      styled: allCells.filter(c => c.style && Object.keys(c.style).length > 0).length,
      bold: allCells.filter(c => c.style?.bold).length,
      italic: allCells.filter(c => c.style?.italic).length,
      solidFill: allCells.filter(c => c.style?.fillType === 'solid').length,
      withBorder: allCells.filter(c => c.style?.borderBottom || c.style?.borderTop || c.style?.borderLeft || c.style?.borderRight).length,
    };
    console.log('Style stats:', stats);
    // Not a strict assertion — just ensure no crash.
    expect(stats.total).toBeGreaterThan(0);
  });
});

// ── parseStyles: inline unit test (no fixture needed) ────────────────────────

describe('xlsx-parser — parseStyles (inline XML)', () => {
  // We test parseStyles indirectly via parseXlsxBase64 with a minimal synthetic .xlsx.
  // For a lighter test, we verify that the module exports are intact.
  it('parseXlsxBase64 is exported and is a function', () => {
    expect(typeof parseXlsxBase64).toBe('function');
  });
});

// ── Drawing layer: images + text shapes (synthetic workbook, no fixture) ─────

/** 1x1 transparent PNG. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function buildWorkbookWithDrawing(): Promise<string> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file('_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`);
  zip.file('xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheets><sheet name="Report" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>` +
    `</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`);
  zip.file('xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetData><row r="1" ht="30"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c></row></sheetData>` +
    `<drawing r:id="rId9"/></worksheet>`);
  zip.file('xl/worksheets/_rels/sheet1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>` +
    `</Relationships>`);
  zip.file('xl/drawings/drawing1.xml',
    `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<xdr:twoCellAnchor>` +
      `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="rptHeader_ReportLogo"/></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>` +
      `<xdr:clientData/></xdr:twoCellAnchor>` +
    `<xdr:oneCellAnchor>` +
      `<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:ext cx="1905000" cy="381000"/>` +
      `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="rptHeader_ReportTitle"/></xdr:nvSpPr>` +
      `<xdr:txBody><a:bodyPr/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1600" b="1"/><a:t>Free text invoice</a:t></a:r></a:p></xdr:txBody></xdr:sp>` +
      `<xdr:clientData/></xdr:oneCellAnchor>` +
    `</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>` +
    `</Relationships>`);
  zip.file('xl/media/image1.png', TINY_PNG_B64, { base64: true });
  return zip.generateAsync({ type: 'base64' });
}

describe('xlsx-parser — drawing layer', () => {
  let sheet: XlsxWorkbook['sheets'][number];

  beforeAll(async () => {
    const wb = await parseXlsxBase64(await buildWorkbookWithDrawing());
    sheet = wb.sheets[0]!;
  });

  it('extracts the embedded picture with a usable data URL', () => {
    expect(sheet.images).toHaveLength(1);
    const logo = sheet.images[0]!;
    expect(logo.name).toBe('rptHeader_ReportLogo');
    expect(logo.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('keeps the picture anchor so it can be positioned over the grid', () => {
    const logo = sheet.images[0]!;
    expect(logo.from).toEqual({ col: 0, colOff: 0, row: 0, rowOff: 0 });
    expect(logo.to).toEqual({ col: 2, colOff: 0, row: 3, rowOff: 0 });
  });

  it('extracts floating text shapes with their formatting', () => {
    expect(sheet.textShapes).toHaveLength(1);
    const title = sheet.textShapes[0]!;
    expect(title.name).toBe('rptHeader_ReportTitle');
    expect(title.text).toBe('Free text invoice');
    expect(title.fontSize).toBe(16);
    expect(title.bold).toBe(true);
    expect(title.align).toBe('ctr');
  });

  it('resolves oneCellAnchor extents instead of a "to" anchor', () => {
    const title = sheet.textShapes[0]!;
    expect(title.to).toBeUndefined();
    expect(title.ext).toEqual({ cx: 1905000, cy: 381000 });
  });

  it('reads explicit row heights', () => {
    expect(sheet.rows[0]!.height).toBe(30);
  });
});
