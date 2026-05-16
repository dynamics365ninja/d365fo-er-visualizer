/**
 * Lightweight .xlsx parser for Excel template visualization.
 * Uses JSZip to decompress the .xlsx (OpenXML ZIP) and fast-xml-parser
 * (via manual DOM walking) to extract sheet data.
 */
import JSZip from 'jszip';

// ─── Public types ─────────────────────────────────────────────────────────

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
  /** Named ranges: uppercased name → normalized first-cell ref (e.g. "CONTACTINFO_LABEL" → "B3") */
  definedNames: Map<string, string>;
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
  style?: XlsxCellStyle;
}

/** Resolved visual style for a cell (derived from xl/styles.xml). */
export interface XlsxCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;       // in points
  fontColor?: string;      // ARGB hex, e.g. "FF000000"
  bgColor?: string;        // ARGB hex fill background
  fgColor?: string;        // ARGB hex fill foreground (pattern)
  fillType?: string;       // patternFill type, e.g. "solid"
  wrapText?: boolean;
  hAlign?: string;         // "left" | "center" | "right" | "general" | …
  vAlign?: string;         // "top" | "center" | "bottom"
  numFmtId?: number;
  borderLeft?: string;     // "thin" | "medium" | "thick" | …
  borderRight?: string;
  borderTop?: string;
  borderBottom?: string;
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

  // 2. Read workbook.xml to get sheet names & rIds, and defined names
  const { sheetMeta, definedNames } = await readWorkbookData(zip);

  // 3. Read workbook.xml.rels to map rIds to file paths
  const relMap = await readRels(zip, 'xl/_rels/workbook.xml.rels');

  // 4. Parse theme colors
  const themeColors = await readThemeColors(zip);

  // 5. Parse styles
  const styles = await readStyles(zip, themeColors);

  // 6. Parse each sheet
  const sheets: XlsxSheet[] = [];
  for (const meta of sheetMeta) {
    const relPath = relMap.get(meta.rId);
    if (!relPath) continue;
    const sheetPath = relPath.startsWith('/') ? relPath.slice(1) : `xl/${relPath}`;
    const sheetXml = await zip.file(sheetPath)?.async('text');
    if (!sheetXml) continue;
    sheets.push(parseSheet(meta.name, sheetXml, sharedStrings, styles));
  }

  return { sheets, definedNames };
}

// ─── Internals ────────────────────────────────────────────────────────────

/** Minimal XML tag/attribute parser — avoids adding full XML parser dependency to UI. */
function parseXmlTags(xml: string, tagName: string): { attrs: Record<string, string>; inner: string }[] {
  const results: { attrs: Record<string, string>; inner: string }[] = [];
  // Match truly self-closing tags first (<tag .../>) then open/close pairs (<tag ...>inner</tag>).
  // IMPORTANT: first alternative must only match "/>" not ">" — otherwise the opening tag of a
  // non-self-closing element is consumed and the inner content is never captured.
  const pattern = new RegExp(
    `<${tagName}(\\s[^>]*)?\\/>|<${tagName}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
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

async function readWorkbookData(zip: JSZip): Promise<{ sheetMeta: { name: string; sheetId: string; rId: string }[]; definedNames: Map<string, string> }> {
  const file = zip.file('xl/workbook.xml');
  if (!file) return { sheetMeta: [], definedNames: new Map() };
  const xml = await file.async('text');

  const sheetTags = parseXmlTags(xml, 'sheet');
  const sheetMeta = sheetTags.map(s => ({
    name: s.attrs['name'] ?? '',
    sheetId: s.attrs['sheetId'] ?? '',
    rId: s.attrs['r:id'] ?? '',
  }));

  // Parse <definedName> elements — content is like "Sheet1!$B$3" or "Sheet1!$B$3:$D$5"
  const definedNames = new Map<string, string>();
  const defSection = extractSection(xml, 'definedNames');
  if (defSection) {
    const defTags = parseXmlTags(defSection, 'definedName');
    for (const d of defTags) {
      const name = d.attrs['name'];
      if (!name) continue;
      // Normalize: strip sheet prefix, dollar signs, take top-left cell
      // e.g. "Sheet1!$B$3:$D$5" → "B3"
      const raw = d.inner.trim();
      const cellPart = raw.split('!').pop() ?? raw; // after "Sheet1!"
      const topLeft = cellPart.split(':')[0]!.replace(/\$/g, '').toUpperCase();
      if (/^[A-Z]+\d+$/.test(topLeft)) {
        definedNames.set(name.toUpperCase(), topLeft);
      }
    }
  }

  return { sheetMeta, definedNames };
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

// ─── Theme colors ────────────────────────────────────────────────────────

/**
 * Excel theme color index → clrScheme slot mapping.
 * The theme= attribute does NOT follow XML element order — Excel swaps the
 * dk/lt pairs so that "Background 1" (lt1) is index 0 and "Text 1" (dk1)
 * is index 1 (and likewise lt2/dk2 for indices 2/3).
 */
const THEME_SLOT_ORDER = ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];

/** Extract the 6-char hex from a theme XML color node (srgbClr or sysClr). */
function extractThemeHex(inner: string): string | undefined {
  // <a:srgbClr val="RRGGBB"/>
  const srgb = /a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(inner);
  if (srgb) return srgb[1]!.toUpperCase();
  // <a:sysClr lastClr="RRGGBB" val="..."/>
  const sys = /a:sysClr[^>]+lastClr="([0-9A-Fa-f]{6})"/.exec(inner);
  if (sys) return sys[1]!.toUpperCase();
  return undefined;
}

/**
 * Apply OOXML tint to a 6-char hex color.
 * tint > 0: lighten toward white.  tint < 0: darken toward black.
 */
function applyTint(hex: string, tint: number): string {
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  let nr: number, ng: number, nb: number;
  if (tint > 0) {
    nr = r + (255 - r) * tint;
    ng = g + (255 - g) * tint;
    nb = b + (255 - b) * tint;
  } else {
    nr = r * (1 + tint);
    ng = g * (1 + tint);
    nb = b * (1 + tint);
  }
  return [clamp(nr),clamp(ng),clamp(nb)].map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase();
}

async function readThemeColors(zip: JSZip): Promise<string[]> {
  // Theme file is usually xl/theme/theme1.xml
  const candidates = ['xl/theme/theme1.xml','xl/theme/Theme1.xml'];
  let xml = '';
  for (const path of candidates) {
    const f = zip.file(path);
    if (f) { xml = await f.async('text'); break; }
  }
  if (!xml) return [];

  // Extract the <a:clrScheme> block
  const schemeStart = xml.indexOf('<a:clrScheme');
  const schemeEnd = xml.indexOf('</a:clrScheme>', schemeStart);
  if (schemeStart === -1 || schemeEnd === -1) return [];
  const schemeXml = xml.slice(schemeStart, schemeEnd + '</a:clrScheme>'.length);

  const colors: string[] = [];
  for (const slot of THEME_SLOT_ORDER) {
    // Match <a:dk1>...</a:dk1>
    const tagStart = schemeXml.indexOf(`<a:${slot}`);
    const tagEnd = schemeXml.indexOf(`</a:${slot}>`, tagStart);
    if (tagStart === -1 || tagEnd === -1) { colors.push(''); continue; }
    const inner = schemeXml.slice(tagStart, tagEnd + `</a:${slot}>`.length);
    colors.push(extractThemeHex(inner) ?? '');
  }
  return colors;
}

/** Resolve a color element (attrs with rgb/theme/tint) to a 6-char hex string or undefined. */
function resolveColor(attrs: Record<string, string>, themeColors: string[]): string | undefined {
  if (attrs['rgb']) {
    // ARGB — strip alpha
    const rgb = attrs['rgb'];
    return rgb.length === 8 ? rgb.slice(2).toUpperCase() : rgb.toUpperCase();
  }
  if (attrs['theme'] !== undefined) {
    const idx = parseInt(attrs['theme'], 10);
    const base = themeColors[idx];
    if (!base) return undefined;
    const tint = attrs['tint'] ? parseFloat(attrs['tint']) : 0;
    return tint !== 0 ? applyTint(base, tint) : base;
  }
  return undefined;
}

// ─── Styles ──────────────────────────────────────────────────────────────

/** Resolved styles table indexed by xf (cell format) index. */
type StylesTable = XlsxCellStyle[];

async function readStyles(zip: JSZip, themeColors: string[]): Promise<StylesTable> {
  const file = zip.file('xl/styles.xml');
  if (!file) return [];
  const xml = await file.async('text');
  return parseStyles(xml, themeColors);
}

function parseStyles(xml: string, themeColors: string[] = []): StylesTable {
  // ── 1. numFmts (optional, for future number formatting) ──────────────────
  // ── 2. fonts ─────────────────────────────────────────────────────────────
  const fontSection = extractSection(xml, 'fonts');
  const fontTags = parseXmlTags(fontSection, 'font');
  const fonts = fontTags.map(f => ({
    bold: f.inner.includes('<b/>') || f.inner.includes('<b>') || /<b\s+val="1"/.test(f.inner),
    italic: f.inner.includes('<i/>') || f.inner.includes('<i>') || /<i\s+val="1"/.test(f.inner),
    underline: f.inner.includes('<u/>') || f.inner.includes('<u>') || /<u\s+val="single"/.test(f.inner),
    fontSize: (() => { const sz = parseXmlTags(f.inner, 'sz'); return sz.length ? parseFloat(sz[0]!.attrs['val'] ?? '0') || undefined : undefined; })(),
    fontColor: (() => { const clr = parseXmlTags(f.inner, 'color'); return clr.length ? resolveColor(clr[0]!.attrs, themeColors) : undefined; })(),
  }));

  // ── 3. fills ─────────────────────────────────────────────────────────────
  const fillSection = extractSection(xml, 'fills');
  const fillTags = parseXmlTags(fillSection, 'fill');
  const fills = fillTags.map(f => {
    const pf = parseXmlTags(f.inner, 'patternFill');
    if (!pf.length) return {};
    const pfEl = pf[0]!;
    const fillType = pfEl.attrs['patternType'] ?? '';
    const fgTags = parseXmlTags(pfEl.inner, 'fgColor');
    const bgTags = parseXmlTags(pfEl.inner, 'bgColor');
    return {
      fillType,
      fgColor: fgTags.length ? resolveColor(fgTags[0]!.attrs, themeColors) : undefined,
      bgColor: bgTags.length ? resolveColor(bgTags[0]!.attrs, themeColors) : undefined,
    };
  });

  // ── 4. borders ───────────────────────────────────────────────────────────
  const borderSection = extractSection(xml, 'borders');
  const borderTags = parseXmlTags(borderSection, 'border');
  const borders = borderTags.map(b => ({
    borderLeft:   (() => { const t = parseXmlTags(b.inner, 'left');   return t.length ? t[0]!.attrs['style'] : undefined; })(),
    borderRight:  (() => { const t = parseXmlTags(b.inner, 'right');  return t.length ? t[0]!.attrs['style'] : undefined; })(),
    borderTop:    (() => { const t = parseXmlTags(b.inner, 'top');    return t.length ? t[0]!.attrs['style'] : undefined; })(),
    borderBottom: (() => { const t = parseXmlTags(b.inner, 'bottom'); return t.length ? t[0]!.attrs['style'] : undefined; })(),
  }));

  // ── 5. cellXfs — the main xf table referenced by cell s= attribute ───────
  const cellXfsSection = extractSection(xml, 'cellXfs');
  const xfTags = parseXmlTags(cellXfsSection, 'xf');
  return xfTags.map(xf => {
    const fontIdx  = parseInt(xf.attrs['fontId']  ?? '0', 10);
    const fillIdx  = parseInt(xf.attrs['fillId']  ?? '0', 10);
    const borderIdx = parseInt(xf.attrs['borderId'] ?? '0', 10);
    const numFmtId  = parseInt(xf.attrs['numFmtId'] ?? '0', 10);
    const font   = fonts[fontIdx]   ?? {};
    const fill   = fills[fillIdx]   ?? {};
    const border = borders[borderIdx] ?? {};

    // Alignment is a child element inside xf.
    const alignTags = parseXmlTags(xf.inner, 'alignment');
    const align = alignTags.length ? alignTags[0]!.attrs : {};

    const style: XlsxCellStyle = {};
    if (font.bold)        style.bold = true;
    if (font.italic)      style.italic = true;
    if (font.underline)   style.underline = true;
    if (font.fontSize)    style.fontSize = font.fontSize;
    if (font.fontColor)   style.fontColor = font.fontColor;
    if (fill.fillType && fill.fillType !== 'none') style.fillType = fill.fillType;
    if (fill.fgColor)     style.fgColor = fill.fgColor;
    if (fill.bgColor)     style.bgColor = fill.bgColor;
    if (border.borderLeft)   style.borderLeft   = border.borderLeft;
    if (border.borderRight)  style.borderRight  = border.borderRight;
    if (border.borderTop)    style.borderTop    = border.borderTop;
    if (border.borderBottom) style.borderBottom = border.borderBottom;
    if (align['wrapText'] === '1') style.wrapText = true;
    if (align['horizontal']) style.hAlign = align['horizontal'];
    if (align['vertical'])   style.vAlign = align['vertical'];
    if (numFmtId)            style.numFmtId = numFmtId;
    return style;
  });
}

/**
 * Extract the inner content of a top-level element by tag name.
 * Handles <fonts count="…">…</fonts> patterns.
 */
function extractSection(xml: string, tag: string): string {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`);
  const m = open.exec(xml);
  if (!m) return '';
  const start = m.index + m[0].length;
  const closeTag = `</${tag}>`;
  const end = xml.indexOf(closeTag, start);
  return end === -1 ? '' : xml.slice(start, end);
}

function parseSheet(name: string, xml: string, sharedStrings: string[], styles: StylesTable): XlsxSheet {
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

      cells.push({ ref, col, row, value, type, styleIndex, style: styleIndex !== undefined ? styles[styleIndex] : undefined });
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
