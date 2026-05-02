/**
 * Lightweight .xlsx parser for Excel template visualization.
 * Uses JSZip to decompress the .xlsx (OpenXML ZIP) and fast-xml-parser
 * (via manual DOM walking) to extract sheet data.
 */
import JSZip from 'jszip';

// ─── Public types ─────────────────────────────────────────────────────────

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
}

export interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
  merges: XlsxMerge[];
  colWidths: Map<number, number>; // 1-based column index → width in chars
}

export interface XlsxRow {
  index: number; // 1-based
  height?: number;
  cells: XlsxCell[];
}

export interface XlsxCell {
  ref: string;   // e.g. "A1"
  col: number;   // 1-based
  row: number;   // 1-based
  value: string;
  type: 'string' | 'number' | 'bool' | 'error' | 'empty';
  styleIndex?: number;
}

export interface XlsxMerge {
  ref: string; // e.g. "A1:C3"
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

// ─── Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a base64-encoded .xlsx file and return structured workbook data.
 */
export async function parseXlsxBase64(base64: string): Promise<XlsxWorkbook> {
  const zip = await JSZip.loadAsync(base64, { base64: true });

  // 1. Read shared strings
  const sharedStrings = await readSharedStrings(zip);

  // 2. Read workbook.xml to get sheet names & rIds
  const sheetMeta = await readWorkbookSheets(zip);

  // 3. Read workbook.xml.rels to map rIds to file paths
  const relMap = await readRels(zip, 'xl/_rels/workbook.xml.rels');

  // 4. Parse each sheet
  const sheets: XlsxSheet[] = [];
  for (const meta of sheetMeta) {
    const relPath = relMap.get(meta.rId);
    if (!relPath) continue;
    const sheetPath = relPath.startsWith('/') ? relPath.slice(1) : `xl/${relPath}`;
    const sheetXml = await zip.file(sheetPath)?.async('text');
    if (!sheetXml) continue;
    sheets.push(parseSheet(meta.name, sheetXml, sharedStrings));
  }

  return { sheets };
}

// ─── Internals ────────────────────────────────────────────────────────────

/** Minimal XML tag/attribute parser — avoids adding full XML parser dependency to UI. */
function parseXmlTags(xml: string, tagName: string): { attrs: Record<string, string>; inner: string }[] {
  const results: { attrs: Record<string, string>; inner: string }[] = [];
  // Match both self-closing and open/close tags
  const pattern = new RegExp(
    `<${tagName}(\\s[^>]*)?\\/?>|<${tagName}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(xml)) !== null) {
    const attrStr = m[1] ?? m[2] ?? '';
    const inner = m[3] ?? '';
    const attrs: Record<string, string> = {};
    const attrPat = /(\w+(?::\w+)?)="([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = attrPat.exec(attrStr)) !== null) {
      attrs[am[1]] = am[2];
    }
    results.push({ attrs, inner });
  }
  return results;
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  const xml = await file.async('text');
  const strings: string[] = [];
  // Each <si> contains one or more <t> elements (rich text uses <r><t>)
  const siTags = parseXmlTags(xml, 'si');
  for (const si of siTags) {
    // Collect all <t> text inside this <si>
    const tTags = parseXmlTags(si.inner, 't');
    strings.push(tTags.map(t => t.inner).join(''));
  }
  return strings;
}

async function readWorkbookSheets(zip: JSZip): Promise<{ name: string; sheetId: string; rId: string }[]> {
  const file = zip.file('xl/workbook.xml');
  if (!file) return [];
  const xml = await file.async('text');
  const sheetTags = parseXmlTags(xml, 'sheet');
  return sheetTags.map(s => ({
    name: s.attrs['name'] ?? '',
    sheetId: s.attrs['sheetId'] ?? '',
    rId: s.attrs['r:id'] ?? '',
  }));
}

async function readRels(zip: JSZip, path: string): Promise<Map<string, string>> {
  const file = zip.file(path);
  if (!file) return new Map();
  const xml = await file.async('text');
  const map = new Map<string, string>();
  const rels = parseXmlTags(xml, 'Relationship');
  for (const r of rels) {
    if (r.attrs['Id'] && r.attrs['Target']) {
      map.set(r.attrs['Id'], r.attrs['Target']);
    }
  }
  return map;
}

function parseSheet(name: string, xml: string, sharedStrings: string[]): XlsxSheet {
  const rows: XlsxRow[] = [];
  const merges: XlsxMerge[] = [];
  const colWidths = new Map<number, number>();

  // Parse column widths from <col> tags
  const colTags = parseXmlTags(xml, 'col');
  for (const col of colTags) {
    const min = parseInt(col.attrs['min'] ?? '0', 10);
    const max = parseInt(col.attrs['max'] ?? '0', 10);
    const width = parseFloat(col.attrs['width'] ?? '0');
    if (width > 0) {
      for (let c = min; c <= max && c <= 200; c++) {
        colWidths.set(c, width);
      }
    }
  }

  // Parse rows
  const rowTags = parseXmlTags(xml, 'row');
  for (const rowTag of rowTags) {
    const rowIndex = parseInt(rowTag.attrs['r'] ?? '0', 10);
    if (!rowIndex) continue;
    const height = rowTag.attrs['ht'] ? parseFloat(rowTag.attrs['ht']) : undefined;

    const cells: XlsxCell[] = [];
    const cellTags = parseXmlTags(rowTag.inner, 'c');
    for (const ct of cellTags) {
      const ref = ct.attrs['r'] ?? '';
      const { col, row } = cellRefToCoords(ref);
      const cellType = ct.attrs['t'] ?? '';
      const styleIndex = ct.attrs['s'] ? parseInt(ct.attrs['s'], 10) : undefined;

      // Extract value
      const vTags = parseXmlTags(ct.inner, 'v');
      const rawValue = vTags.length > 0 ? vTags[0].inner : '';

      let value = '';
      let type: XlsxCell['type'] = 'empty';

      if (cellType === 's' && rawValue) {
        // Shared string index
        const idx = parseInt(rawValue, 10);
        value = sharedStrings[idx] ?? '';
        type = 'string';
      } else if (cellType === 'b') {
        value = rawValue === '1' ? 'TRUE' : 'FALSE';
        type = 'bool';
      } else if (cellType === 'e') {
        value = rawValue;
        type = 'error';
      } else if (cellType === 'str' || cellType === 'inlineStr') {
        // Formula result as string, or inline string
        const isTags = parseXmlTags(ct.inner, 't');
        value = isTags.length > 0 ? isTags[0].inner : rawValue;
        type = 'string';
      } else if (rawValue) {
        value = rawValue;
        type = 'number';
      }

      cells.push({ ref, col, row, value, type, styleIndex });
    }

    if (cells.length > 0) {
      rows.push({ index: rowIndex, height, cells });
    }
  }

  // Parse merge cells
  const mergeTags = parseXmlTags(xml, 'mergeCell');
  for (const mt of mergeTags) {
    const ref = mt.attrs['ref'] ?? '';
    const parts = ref.split(':');
    if (parts.length === 2) {
      const start = cellRefToCoords(parts[0]);
      const end = cellRefToCoords(parts[1]);
      merges.push({
        ref,
        startCol: start.col,
        startRow: start.row,
        endCol: end.col,
        endRow: end.row,
      });
    }
  }

  return { name, rows, merges, colWidths };
}

/** Convert cell reference like "AB12" to { col: 28, row: 12 } (1-based). */
function cellRefToCoords(ref: string): { col: number; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of m[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { col, row: parseInt(m[2], 10) };
}

/** Convert 1-based column number to letter (1→A, 27→AA). */
export function colToLetter(col: number): string {
  let s = '';
  while (col > 0) {
    col--;
    s = String.fromCharCode(65 + (col % 26)) + s;
    col = Math.floor(col / 26);
  }
  return s;
}
