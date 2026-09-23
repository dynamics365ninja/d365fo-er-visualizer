/**
 * Lightweight .xlsx parser for Excel template visualization.
 * Uses JSZip to decompress the .xlsx (OpenXML ZIP) and fast-xml-parser
 * (via manual DOM walking) to extract sheet data.
 */
import JSZip from 'jszip';

// ─── Public types ─────────────────────────────────────────────────────────

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
  /**
   * Named ranges: uppercased name → normalized first-cell ref (e.g.
   * "CONTACTINFO_LABEL" → "B3"). Sheet-less, so a name defined on several
   * sheets keeps its workbook-scoped (else first) definition — use
   * {@link namedAreas} whenever the sheet matters.
   */
  definedNames: Map<string, string>;
  /**
   * Named ranges with their full extent, so a multi-cell range can be
   * highlighted as one area instead of just its anchor cell. Same scoping
   * caveat as {@link definedNames}.
   */
  definedRanges: Map<string, XlsxArea>;
  /** Every named range with the sheet its cells sit on, in document order. */
  namedAreas: XlsxNamedArea[];
}

/** One `<definedName>` that points at cells. */
export interface XlsxNamedArea {
  /** Uppercased, as ER's `ExcelRange` attribute is matched case-insensitively. */
  name: string;
  /** Sheet the cells are on — from the `Sheet!` prefix, else the name's local scope. */
  sheet?: string;
  /** Set when the name is local to one sheet (`localSheetId`); workbook-scoped otherwise. */
  scopeSheet?: string;
  /** Normalized first cell, e.g. "B3". */
  anchor: string;
  /** Extent of the first area — a multi-area name (`A1,C3`) is anchored on its first one. */
  area: XlsxArea;
}

/** A rectangular block of cells, 1-based and inclusive on both ends. */
export interface XlsxArea {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
  merges: XlsxMerge[];
  colWidths: Map<number, number>; // 1-based column index → width in chars
  /** Pictures anchored on the sheet (logos, signatures, …). */
  images: XlsxDrawing[];
  /** Free-floating text boxes from the drawing layer (report title, company name, …). */
  textShapes: XlsxDrawing[];
}

/** Where a drawing sits on the grid. Columns/rows are 0-based, offsets are EMU. */
export interface XlsxAnchorPoint {
  col: number;
  colOff: number;
  row: number;
  rowOff: number;
}

/** A picture or text box from `xl/drawings/drawingN.xml`. */
export interface XlsxDrawing {
  id: string;
  /** Shape name as authored in Excel, e.g. `rptHeader_ReportLogo`. */
  name: string;
  from: XlsxAnchorPoint;
  /** Present for `twoCellAnchor` drawings — the bottom-right grid anchor. */
  to?: XlsxAnchorPoint;
  /** Present for `oneCellAnchor` drawings — explicit size in EMU. */
  ext?: { cx: number; cy: number };
  /** Pictures: `data:` URL of the embedded media, ready for an `<img src>`. */
  dataUrl?: string;
  /** Text boxes: the concatenated run text. */
  text?: string;
  /** Text boxes: font size in points of the first run. */
  fontSize?: number;
  /** Text boxes: resolved 6-char hex colour of the first run. */
  color?: string;
  bold?: boolean;
  /** Text boxes: `l` | `ctr` | `r`. */
  align?: string;
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
export async function parseXlsxBase64(base64: string, options: XlsxParseOptions = {}): Promise<XlsxWorkbook> {
  const zip = createZipReader(
    await JSZip.loadAsync(base64, { base64: true }),
    options.maxUncompressedBytes ?? MAX_XLSX_UNCOMPRESSED_BYTES,
  );

  // 1. Read shared strings
  const sharedStrings = await readSharedStrings(zip);

  // 2. Read workbook.xml to get sheet names & rIds, and defined names
  const { sheetMeta, definedNames, definedRanges, namedAreas } = await readWorkbookData(zip);

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
    const sheetXml = await zip.text(sheetPath);
    if (!sheetXml) continue;
    const sheet = parseSheet(meta.name, sheetXml, sharedStrings, styles);
    // 7. Drawing layer — logos and floating text boxes live outside the cell grid.
    const drawings = await readSheetDrawings(zip, sheetPath, sheetXml, themeColors);
    sheet.images = drawings.images;
    sheet.textShapes = drawings.textShapes;
    sheets.push(sheet);
  }

  return { sheets, definedNames, definedRanges, namedAreas };
}

// ─── Decompression budget ─────────────────────────────────────────────────

/**
 * Ceiling on the bytes inflated out of one workbook. JSZip itself has no
 * limit, and a template can come from any dropped file, so a few kilobytes of
 * zip bomb would otherwise inflate until the tab runs out of memory.
 */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export interface XlsxParseOptions {
  /** Overrides {@link MAX_XLSX_UNCOMPRESSED_BYTES}. */
  maxUncompressedBytes?: number;
}

/** Thrown when a workbook inflates past the decompression budget. */
export class XlsxTooLargeError extends Error {
  constructor(limit: number) {
    super(`The workbook expands to more than ${Math.round(limit / (1024 * 1024))} MB and was not opened.`);
    this.name = 'XlsxTooLargeError';
  }
}

/** Reads zip entries while counting every inflated byte against one shared budget. */
interface ZipReader {
  text(path: string): Promise<string | undefined>;
  base64(path: string): Promise<string | undefined>;
}

/**
 * `internalStream` is public JSZip API (documented, and what `async()` is
 * built on) but missing from its typings.
 */
type StreamableZipObject = JSZip.JSZipObject & {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
};

function createZipReader(zip: JSZip, limit: number): ZipReader {
  let used = 0;

  // Streaming lets the read stop as soon as the budget runs out, instead of
  // inflating the whole entry first and only then noticing it was too big.
  const bytes = (path: string): Promise<Uint8Array | undefined> => {
    const file = zip.file(path) as StreamableZipObject | null;
    if (!file) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      let settled = false;
      const stream = file.internalStream('uint8array');
      stream
        .on('data', chunk => {
          if (settled) return;
          used += chunk.length;
          if (used > limit) {
            settled = true;
            stream.pause();
            reject(new XlsxTooLargeError(limit));
            return;
          }
          chunks.push(chunk);
          length += chunk.length;
        })
        .on('error', err => {
          if (settled) return;
          settled = true;
          reject(err);
        })
        .on('end', () => {
          if (settled) return;
          settled = true;
          const out = new Uint8Array(length);
          let at = 0;
          for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
          resolve(out);
        })
        .resume();
    });
  };

  const decoder = new TextDecoder('utf-8');
  return {
    text: async path => {
      const data = await bytes(path);
      return data ? decoder.decode(data) : undefined;
    },
    base64: async path => {
      const data = await bytes(path);
      if (!data) return undefined;
      // Chunked, so a large picture does not overflow the argument list.
      let binary = '';
      for (let i = 0; i < data.length; i += 0x8000) {
        binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
  };
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

async function readSharedStrings(zip: ZipReader): Promise<string[]> {
  const xml = await zip.text('xl/sharedStrings.xml');
  if (!xml) return [];
  const strings: string[] = [];
  // Each <si> contains one or more <t> elements (rich text uses <r><t>)
  const siTags = parseXmlTags(xml, 'si');
  for (const si of siTags) {
    // Collect all <t> text inside this <si>, minus the phonetic (<rPh>) runs
    // East Asian workbooks attach — those are reading hints, not cell text.
    const tTags = parseXmlTags(si.inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''), 't');
    strings.push(decodeXmlEntities(tTags.map(t => t.inner).join('')));
  }
  return strings;
}

/**
 * Split a defined name's formula into its areas and each area into its
 * optional sheet and its cells: `'My sheet'!$A$1:$B$2,Other!$C$3` →
 * `[{ sheet: 'My sheet', cells: '$A$1:$B$2' }, { sheet: 'Other', cells: '$C$3' }]`.
 * A quoted sheet name may itself hold `!`, `,` and doubled `''` quotes.
 */
export function splitDefinedNameAreas(formula: string): { sheet?: string; cells: string }[] {
  const areas: { sheet?: string; cells: string }[] = [];
  let sheet: string | undefined;
  let buf = '';
  let i = 0;
  const text = formula.trim();
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'" && buf === '') {
      // Quoted sheet name — runs to the next lone quote.
      let name = '';
      i++;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") { name += "'"; i += 2; continue; }
          i++;
          break;
        }
        name += text[i++];
      }
      buf = name;
      // Only a sheet if the `!` follows; otherwise keep it as plain text.
      if (text[i] === '!') { sheet = name; buf = ''; i++; }
      continue;
    }
    if (ch === '!') { sheet = buf; buf = ''; i++; continue; }
    if (ch === ',') {
      areas.push({ sheet, cells: buf.trim() });
      sheet = undefined;
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim() || sheet !== undefined) areas.push({ sheet, cells: buf.trim() });
  return areas;
}

/** `$B$3:$D$5` → anchor "B3" and the area it spans; undefined for non-cell formulas. */
function parseCellArea(cells: string): { anchor: string; area: XlsxArea } | undefined {
  const bounds = cells.split(':').map(part => part.replace(/\$/g, '').toUpperCase());
  const topLeft = bounds[0]!;
  if (!/^[A-Z]+\d+$/.test(topLeft)) return undefined;
  const bottomRight = bounds[1] && /^[A-Z]+\d+$/.test(bounds[1]) ? bounds[1] : topLeft;
  const start = cellRefToCoords(topLeft);
  const end = cellRefToCoords(bottomRight);
  return {
    anchor: topLeft,
    area: {
      startCol: Math.min(start.col, end.col),
      startRow: Math.min(start.row, end.row),
      endCol: Math.max(start.col, end.col),
      endRow: Math.max(start.row, end.row),
    },
  };
}

async function readWorkbookData(zip: ZipReader): Promise<{
  sheetMeta: { name: string; sheetId: string; rId: string }[];
  definedNames: Map<string, string>;
  definedRanges: Map<string, XlsxArea>;
  namedAreas: XlsxNamedArea[];
}> {
  const xml = await zip.text('xl/workbook.xml');
  if (!xml) return { sheetMeta: [], definedNames: new Map(), definedRanges: new Map(), namedAreas: [] };

  const sheetTags = parseXmlTags(xml, 'sheet');
  const sheetMeta = sheetTags.map(s => ({
    name: decodeXmlEntities(s.attrs['name'] ?? ''),
    sheetId: s.attrs['sheetId'] ?? '',
    rId: s.attrs['r:id'] ?? '',
  }));

  // Parse <definedName> elements — content is like "Sheet1!$B$3" or "Sheet1!$B$3:$D$5"
  const namedAreas: XlsxNamedArea[] = [];
  const defSection = extractSection(xml, 'definedNames');
  if (defSection) {
    const defTags = parseXmlTags(defSection, 'definedName');
    for (const d of defTags) {
      const name = decodeXmlEntities(d.attrs['name'] ?? '');
      if (!name) continue;
      // localSheetId is the 0-based position in <sheets>, not the sheetId.
      const localId = d.attrs['localSheetId'];
      const scopeSheet = localId !== undefined ? sheetMeta[parseInt(localId, 10)]?.name : undefined;
      // Only the first area anchors the name — that is the cell ER writes to.
      const first = splitDefinedNameAreas(decodeXmlEntities(d.inner))[0];
      if (!first) continue;
      const parsed = parseCellArea(first.cells);
      if (!parsed) continue;
      namedAreas.push({
        name: name.toUpperCase(),
        sheet: first.sheet ?? scopeSheet,
        scopeSheet,
        anchor: parsed.anchor,
        area: parsed.area,
      });
    }
  }

  // Sheet-less lookups: a workbook-scoped name wins over sheet-local ones of
  // the same name, and otherwise the first definition wins.
  const definedNames = new Map<string, string>();
  const definedRanges = new Map<string, XlsxArea>();
  const ordered = [...namedAreas.filter(n => !n.scopeSheet), ...namedAreas.filter(n => n.scopeSheet)];
  for (const n of ordered) {
    if (definedNames.has(n.name)) continue;
    definedNames.set(n.name, n.anchor);
    definedRanges.set(n.name, n.area);
  }

  return { sheetMeta, definedNames, definedRanges, namedAreas };
}

async function readRels(zip: ZipReader, path: string): Promise<Map<string, string>> {
  const xml = await zip.text(path);
  if (!xml) return new Map();
  const map = new Map<string, string>();
  const rels = parseXmlTags(xml, 'Relationship');
  for (const r of rels) {
    if (r.attrs['Id'] && r.attrs['Target']) {
      map.set(r.attrs['Id'], decodeXmlEntities(r.attrs['Target']));
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

async function readThemeColors(zip: ZipReader): Promise<string[]> {
  // Theme file is usually xl/theme/theme1.xml
  const candidates = ['xl/theme/theme1.xml','xl/theme/Theme1.xml'];
  let xml = '';
  for (const path of candidates) {
    const text = await zip.text(path);
    if (text !== undefined) { xml = text; break; }
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

async function readStyles(zip: ZipReader, themeColors: string[]): Promise<StylesTable> {
  const xml = await zip.text('xl/styles.xml');
  if (!xml) return [];
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
        value = decodeXmlEntities(rawValue);
        type = 'error';
      } else if (cellType === 'str' || cellType === 'inlineStr') {
        // Formula result as string (<v>), or inline string (<is>, whose rich
        // text splits into several <r><t> runs).
        const isTags = parseXmlTags(ct.inner, 't');
        value = decodeXmlEntities(isTags.length > 0 ? isTags.map(t => t.inner).join('') : rawValue);
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

  return { name, rows, merges, colWidths, images: [], textShapes: [] };
}

// ─── Drawing layer (pictures + text boxes) ───────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

/** Resolve a relationship target that may be relative (`../media/x.png`) against its owner. */
function resolveZipPath(ownerPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const base = ownerPath.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

/** `<xdr:from>` / `<xdr:to>` → anchor point (0-based col/row + EMU offsets). */
function parseAnchorPoint(inner: string): XlsxAnchorPoint {
  const num = (tag: string) => {
    const found = parseXmlTags(inner, tag);
    return found.length > 0 ? parseInt(found[0]!.inner.trim(), 10) || 0 : 0;
  };
  return {
    col: num('xdr:col'),
    colOff: num('xdr:colOff'),
    row: num('xdr:row'),
    rowOff: num('xdr:rowOff'),
  };
}

/** `<a:schemeClr val="bg1">` and friends → 6-char hex, using the workbook theme. */
function resolveDrawingColor(inner: string, themeColors: string[]): string | undefined {
  const srgb = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(inner);
  if (srgb) return srgb[1]!.toUpperCase();
  const scheme = /<a:schemeClr\s+val="([A-Za-z0-9]+)"/.exec(inner);
  if (!scheme) return undefined;
  // Drawing slot names differ from the clrScheme element names.
  const alias: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  const slot = alias[scheme[1]!] ?? scheme[1]!;
  const idx = THEME_SLOT_ORDER.indexOf(slot);
  return idx >= 0 ? (themeColors[idx] || undefined) : undefined;
}

/**
 * Pictures and text boxes anchored on a sheet.
 *
 * F&O report templates put the company logo, the report title and the company
 * name in the drawing layer rather than in cells, so a preview that only walks
 * the cell grid renders a blank header band.
 */
async function readSheetDrawings(
  zip: ZipReader,
  sheetPath: string,
  sheetXml: string,
  themeColors: string[],
): Promise<{ images: XlsxDrawing[]; textShapes: XlsxDrawing[] }> {
  const empty = { images: [] as XlsxDrawing[], textShapes: [] as XlsxDrawing[] };

  const drawingRefs = parseXmlTags(sheetXml, 'drawing');
  const drawingRid = drawingRefs[0]?.attrs['r:id'];
  if (!drawingRid) return empty;

  const sheetName = sheetPath.split('/').pop()!;
  const sheetRelsPath = resolveZipPath(sheetPath, `_rels/${sheetName}.rels`);
  const sheetRels = await readRels(zip, sheetRelsPath);
  const drawingTarget = sheetRels.get(drawingRid);
  if (!drawingTarget) return empty;

  const drawingPath = resolveZipPath(sheetPath, drawingTarget);
  const drawingXml = await zip.text(drawingPath);
  if (!drawingXml) return empty;

  const drawingRels = await readRels(zip, resolveZipPath(drawingPath, `_rels/${drawingPath.split('/').pop()}.rels`));

  // Media is shared between anchors, so each file is only read once.
  const mediaCache = new Map<string, string | undefined>();
  const readMedia = async (rid: string): Promise<string | undefined> => {
    if (mediaCache.has(rid)) return mediaCache.get(rid);
    const target = drawingRels.get(rid);
    let dataUrl: string | undefined;
    if (target) {
      const mediaPath = resolveZipPath(drawingPath, target);
      const ext = mediaPath.split('.').pop()?.toLowerCase() ?? '';
      const base64 = await zip.base64(mediaPath);
      if (base64) dataUrl = `data:${MIME_BY_EXT[ext] ?? 'application/octet-stream'};base64,${base64}`;
    }
    mediaCache.set(rid, dataUrl);
    return dataUrl;
  };

  const images: XlsxDrawing[] = [];
  const textShapes: XlsxDrawing[] = [];

  for (const anchorTag of ['xdr:twoCellAnchor', 'xdr:oneCellAnchor'] as const) {
    for (const anchor of parseXmlTags(drawingXml, anchorTag)) {
      const fromTags = parseXmlTags(anchor.inner, 'xdr:from');
      if (fromTags.length === 0) continue;
      const from = parseAnchorPoint(fromTags[0]!.inner);
      const toTags = parseXmlTags(anchor.inner, 'xdr:to');
      const to = toTags.length > 0 ? parseAnchorPoint(toTags[0]!.inner) : undefined;
      const extTag = parseXmlTags(anchor.inner, 'xdr:ext')[0];
      const ext = extTag
        ? { cx: parseInt(extTag.attrs['cx'] ?? '0', 10) || 0, cy: parseInt(extTag.attrs['cy'] ?? '0', 10) || 0 }
        : undefined;

      const nameTag = parseXmlTags(anchor.inner, 'xdr:cNvPr')[0];
      const id = nameTag?.attrs['id'] ?? String(images.length + textShapes.length);
      const name = nameTag?.attrs['name'] ?? '';

      const picTags = parseXmlTags(anchor.inner, 'xdr:pic');
      if (picTags.length > 0) {
        const embed = /<a:blip[^>]*r:embed="([^"]+)"/.exec(picTags[0]!.inner);
        const dataUrl = embed ? await readMedia(embed[1]!) : undefined;
        if (dataUrl) images.push({ id, name, from, to, ext, dataUrl });
        continue;
      }

      const spTags = parseXmlTags(anchor.inner, 'xdr:sp');
      if (spTags.length > 0) {
        const body = parseXmlTags(spTags[0]!.inner, 'xdr:txBody')[0];
        if (!body) continue;
        const runs = parseXmlTags(body.inner, 'a:r');
        const text = (runs.length > 0
          ? runs.map(r => parseXmlTags(r.inner, 'a:t').map(t => decodeXmlEntities(t.inner)).join(''))
          : parseXmlTags(body.inner, 'a:t').map(t => decodeXmlEntities(t.inner))
        ).join('').trim();
        if (!text) continue;
        const rPr = runs.length > 0 ? parseXmlTags(runs[0]!.inner, 'a:rPr')[0] : undefined;
        const align = /<a:pPr[^>]*algn="([^"]+)"/.exec(body.inner)?.[1];
        textShapes.push({
          id,
          name,
          from,
          to,
          ext,
          text,
          fontSize: rPr?.attrs['sz'] ? parseInt(rPr.attrs['sz'], 10) / 100 : undefined,
          bold: rPr?.attrs['b'] === '1',
          color: rPr ? resolveDrawingColor(rPr.inner, themeColors) : undefined,
          align,
        });
      }
    }
  }

  return { images, textShapes };
}

const NAMED_XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/**
 * Decode the five XML entities and numeric character references in one pass,
 * so `&amp;lt;` stays the literal text `&lt;` instead of turning into `<`.
 */
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_XML_ENTITIES[body] ?? match;
  });
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
