/**
 * Small .xlsx workbooks built in memory for tests: sheets with inline-string
 * cells, a few styles, merged cells, column widths, row heights and named
 * ranges — enough to exercise the parser and the template comparison.
 */
import JSZip from 'jszip';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Style indexes of the fixture's `cellXfs`. */
export const FIXTURE_STYLE = { plain: 0, bold: 1, yellow: 2, boldYellow: 3 } as const;

export interface FixtureCell {
  v?: string;
  /** A formula, without the leading `=`. */
  f?: string;
  s?: number;
}

export interface FixtureSheet {
  name: string;
  cells: Record<string, string | FixtureCell>;
  rowHeights?: Record<number, number>;
  merges?: string[];
  /** `[min, max, width]` column ranges. */
  cols?: Array<[number, number, number]>;
}

export interface FixtureWorkbook {
  sheets: FixtureSheet[];
  /** `ref` as Excel writes it, e.g. `Sheet1!$B$3:$D$3`. */
  names?: Array<{ name: string; ref: string; localSheet?: number }>;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cellCoords(ref: string): { col: string; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell ref ${ref}`);
  return { col: m[1], row: Number(m[2]) };
}

function colNumber(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function sheetXml(sheet: FixtureSheet): string {
  const rows = new Map<number, string[]>();
  const entries = Object.entries(sheet.cells)
    .map(([ref, raw]) => ({ ref, cell: typeof raw === 'string' ? { v: raw } : raw, ...cellCoords(ref) }))
    .sort((a, b) => a.row - b.row || colNumber(a.col) - colNumber(b.col));
  for (const { ref, cell, row } of entries) {
    const style = cell.s ? ` s="${cell.s}"` : '';
    const formula = cell.f ? `<f>${esc(cell.f)}</f>` : '';
    const xml = cell.v != null && cell.v !== ''
      ? (cell.f
        ? `<c r="${ref}" t="str"${style}>${formula}<v>${esc(cell.v)}</v></c>`
        : `<c r="${ref}" t="inlineStr"${style}><is><t>${esc(cell.v)}</t></is></c>`)
      : `<c r="${ref}"${style}>${formula}</c>`;
    rows.set(row, [...(rows.get(row) ?? []), xml]);
  }
  for (const row of Object.keys(sheet.rowHeights ?? {}).map(Number)) if (!rows.has(row)) rows.set(row, []);
  const rowXml = [...rows.keys()].sort((a, b) => a - b).map(row => {
    const height = sheet.rowHeights?.[row];
    const cells = rows.get(row)!;
    // The parser keeps rows with cells only; a height-only row gets an empty styled cell.
    const body = cells.length > 0 ? cells.join('') : `<c r="A${row}" s="0"/>`;
    return `<row r="${row}"${height ? ` ht="${height}" customHeight="1"` : ''}>${body}</row>`;
  }).join('');
  const cols = sheet.cols?.length
    ? `<cols>${sheet.cols.map(([min, max, width]) => `<col min="${min}" max="${max}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${cols}<sheetData>${rowXml}</sheetData>${merges}</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${MAIN_NS}">`
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/>'
  + '<xf numFmtId="0" fontId="0" fillId="2" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0"/></cellXfs>'
  + '</styleSheet>';

export async function buildWorkbook(spec: FixtureWorkbook): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + spec.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>');
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const names = spec.names?.length
    ? `<definedNames>${spec.names.map(n => `<definedName name="${esc(n.name)}"${n.localSheet != null ? ` localSheetId="${n.localSheet}"` : ''}>${esc(n.ref)}</definedName>`).join('')}</definedNames>`
    : '';
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>`
    + spec.sheets.map((sheet, i) => `<sheet name="${esc(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + `</sheets>${names}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="${PKG_REL_NS}">`
    + spec.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${spec.sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>`
    + '</Relationships>');
  zip.file('xl/styles.xml', STYLES_XML);
  spec.sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildWorkbookBase64(spec: FixtureWorkbook): Promise<string> {
  const bytes = await buildWorkbook(spec);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
