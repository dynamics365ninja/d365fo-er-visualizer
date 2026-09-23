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
import {
  parseXlsxBase64,
  splitDefinedNameAreas,
  decodeXmlEntities,
  XlsxTooLargeError,
  type XlsxWorkbook,
  type XlsxCellStyle,
} from './xlsx-parser.js';

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

// ── Entities, sheet-scoped names, decompression budget (synthetic, no fixture) ──

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Two sheets, one of them named with an entity, plus every flavour of defined name. */
async function buildWorkbookWithNames(extraFiles: Record<string, string> = {}): Promise<string> {
  const zip = new JSZip();
  zip.file('xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NS}">` +
    `<sheets>` +
      `<sheet name="R&amp;D" sheetId="7" r:id="rId1"/>` +
      `<sheet name="My sheet" sheetId="3" r:id="rId2"/>` +
    `</sheets>` +
    `<definedNames>` +
      // The same name, local to each sheet — must not overwrite each other.
      `<definedName name="Total" localSheetId="0">'R&amp;D'!$B$2</definedName>` +
      `<definedName name="Total" localSheetId="1">'My sheet'!$C$4:$D$5</definedName>` +
      // Workbook-scoped, quoted sheet name with a doubled quote and a "!" in it.
      `<definedName name="Quoted">'It''s!odd'!$A$1</definedName>` +
      // Multi-area: the first area anchors the name.
      `<definedName name="Multi">'My sheet'!$E$6:$F$7,'R&amp;D'!$A$9</definedName>` +
      // Not a cell reference — dropped.
      `<definedName name="Broken">#REF!</definedName>` +
    `</definedNames>` +
    `</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/>` +
    `</Relationships>`);
  zip.file('xl/sharedStrings.xml',
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<si><t>R&amp;D</t></si>` +
    // Already-escaped text must come out as the literal "&lt;", not as "<".
    `<si><t>a &amp;lt; b</t></si>` +
    `<si><r><t>Tom </t></r><r><t>&amp; Jerry</t></r><rPh sb="0" eb="1"><t>PHONETIC</t></rPh></si>` +
    `</sst>`);
  zip.file('xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1">` +
      `<c r="A1" t="s"><v>0</v></c>` +
      `<c r="B1" t="s"><v>1</v></c>` +
      `<c r="C1" t="s"><v>2</v></c>` +
      `<c r="D1" t="inlineStr"><is><r><t>&lt;b&gt;</t></r><r><t> &#169; &#x263A;</t></r></is></c>` +
      `<c r="E1" t="str"><f>A1</f><v>Q&amp;A</v></c>` +
    `</row>` +
    `</sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet2.xml',
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1"><v>1</v></c></row>` +
    `</sheetData></worksheet>`);
  for (const [path, content] of Object.entries(extraFiles)) zip.file(path, content);
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
}

describe('xlsx-parser — XML entities', () => {
  let wb: XlsxWorkbook;
  beforeAll(async () => { wb = await parseXlsxBase64(await buildWorkbookWithNames()); });

  const cell = (ref: string) => wb.sheets[0]!.rows.flatMap(r => r.cells).find(c => c.ref === ref)!;

  it('decodes shared strings', () => {
    expect(cell('A1').value).toBe('R&D');
  });

  it('decodes exactly once', () => {
    expect(cell('B1').value).toBe('a &lt; b');
  });

  it('joins rich-text runs and leaves out phonetic hints', () => {
    expect(cell('C1').value).toBe('Tom & Jerry');
  });

  it('decodes inline strings across runs, numeric references included', () => {
    expect(cell('D1').value).toBe('<b> © ☺');
  });

  it('decodes formula string results', () => {
    expect(cell('E1').value).toBe('Q&A');
  });

  it('decodes sheet names', () => {
    expect(wb.sheets.map(s => s.name)).toEqual(['R&D', 'My sheet']);
  });
});

describe('xlsx-parser — defined names keep their sheet', () => {
  let wb: XlsxWorkbook;
  beforeAll(async () => { wb = await parseXlsxBase64(await buildWorkbookWithNames()); });

  it('keeps each sheet-local definition of a repeated name', () => {
    expect(wb.namedAreas.filter(n => n.name === 'TOTAL')).toEqual([
      { name: 'TOTAL', sheet: 'R&D', scopeSheet: 'R&D', anchor: 'B2', area: { startCol: 2, startRow: 2, endCol: 2, endRow: 2 } },
      { name: 'TOTAL', sheet: 'My sheet', scopeSheet: 'My sheet', anchor: 'C4', area: { startCol: 3, startRow: 4, endCol: 4, endRow: 5 } },
    ]);
  });

  it('reads quoted sheet names with doubled quotes and "!"', () => {
    const quoted = wb.namedAreas.find(n => n.name === 'QUOTED')!;
    expect(quoted.sheet).toBe("It's!odd");
    expect(quoted.scopeSheet).toBeUndefined();
    expect(quoted.anchor).toBe('A1');
  });

  it('anchors a multi-area name on its first area', () => {
    const multi = wb.namedAreas.find(n => n.name === 'MULTI')!;
    expect(multi.sheet).toBe('My sheet');
    expect(multi.anchor).toBe('E6');
    expect(wb.definedNames.get('MULTI')).toBe('E6');
    expect(wb.definedRanges.get('MULTI')).toEqual({ startCol: 5, startRow: 6, endCol: 6, endRow: 7 });
  });

  it('drops names that do not point at cells', () => {
    expect(wb.namedAreas.some(n => n.name === 'BROKEN')).toBe(false);
  });

  it('keeps the first definition in the sheet-less maps', () => {
    expect(wb.definedNames.get('TOTAL')).toBe('B2');
  });
});

describe('splitDefinedNameAreas', () => {
  it('splits plain and quoted areas', () => {
    expect(splitDefinedNameAreas("Sheet1!$A$1:$B$2,'a, b'!$C$3")).toEqual([
      { sheet: 'Sheet1', cells: '$A$1:$B$2' },
      { sheet: 'a, b', cells: '$C$3' },
    ]);
  });

  it('leaves the sheet out when there is no prefix', () => {
    expect(splitDefinedNameAreas('$A$1')).toEqual([{ sheet: undefined, cells: '$A$1' }]);
  });
});

describe('decodeXmlEntities', () => {
  it('decodes named and numeric references in one pass', () => {
    expect(decodeXmlEntities('&lt;&amp;amp;&#38;lt;&#x41;&quot;&apos;&gt;')).toBe('<&amp;&lt;A"\'>');
  });

  it('leaves unknown or out-of-range references alone', () => {
    expect(decodeXmlEntities('&nbsp; &#99999999;')).toBe('&nbsp; &#99999999;');
  });
});

describe('xlsx-parser — decompression budget', () => {
  // Highly compressible, so the zip itself stays small while it inflates to 2 MB.
  const padding = { 'xl/theme/theme1.xml': 'x'.repeat(2 * 1024 * 1024) };

  it('refuses a workbook that inflates past the limit', async () => {
    const base64 = await buildWorkbookWithNames(padding);
    expect(base64.length).toBeLessThan(64 * 1024);
    await expect(parseXlsxBase64(base64, { maxUncompressedBytes: 1024 * 1024 }))
      .rejects.toBeInstanceOf(XlsxTooLargeError);
  });

  it('opens the same workbook under the default limit', async () => {
    const wb = await parseXlsxBase64(await buildWorkbookWithNames(padding));
    expect(wb.sheets).toHaveLength(2);
  });
});
