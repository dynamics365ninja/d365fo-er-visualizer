/**
 * What changed inside the Excel template of a format between two versions:
 * sheets, cell texts, formulas and styles, merged cells, named ranges (what
 * ER binds its cells to), pictures and text boxes, column widths and row
 * heights. Rows are lined up first, so a row inserted near the top does not
 * report every cell below it as changed — it is one added row. Pure: the
 * comparison view lists the result and colours the two grids with it.
 */
import { colToLetter, type XlsxArea, type XlsxCell, type XlsxCellStyle, type XlsxDrawing, type XlsxNamedArea, type XlsxSheet, type XlsxWorkbook } from './xlsx-parser';
import { alignSequences, textSimilarity } from './sequence-diff';
import { diffProperties, fingerprint, type ChangeKind, type DiffEntry, type DiffSection, type PropertyChange } from './version-diff';

/** How a cell of one side differs from its twin — `style` when only its look changed. */
export type CellMark = 'added' | 'removed' | 'changed' | 'style';
export type RowMark = 'added' | 'removed' | 'changed';

export interface SheetComparison {
  key: string;
  /** The newer sheet's name, the older one's when the sheet was removed. */
  name: string;
  change: ChangeKind | 'same';
  older?: XlsxSheet;
  newer?: XlsxSheet;
  /** Row numbers (1-based) of the twin row on the other side. */
  olderToNewer: Map<number, number>;
  newerToOlder: Map<number, number>;
  olderMarks: Map<string, CellMark>;
  newerMarks: Map<string, CellMark>;
  olderRowMarks: Map<number, RowMark>;
  newerRowMarks: Map<number, RowMark>;
  /** Changed cells in reading order: what "next change" walks. */
  cellChanges: TemplateCellChange[];
}

export interface TemplateCellChange {
  change: ChangeKind;
  /** Only the look of the cell changed. */
  styleOnly: boolean;
  olderRef?: string;
  newerRef?: string;
  properties: PropertyChange[];
}

export interface WorkbookComparison {
  sheets: SheetComparison[];
  /** One section per sheet that changed, then the named ranges. */
  sections: DiffSection[];
  counts: Record<ChangeKind, number>;
}

type Props = Record<string, string | undefined>;

// ─── Values ───

function hex(argb: string | undefined): string | undefined {
  if (!argb) return undefined;
  const six = argb.replace(/^#/, '').slice(-6).toUpperCase();
  return /^[0-9A-F]{6}$/.test(six) ? `#${six}` : undefined;
}

function yes(value: boolean | undefined): string | undefined {
  return value ? '1' : undefined;
}

/** The look of a cell, one property per thing Excel lets you set. */
export function cellStyleProps(style: XlsxCellStyle | undefined): Props {
  if (!style) return {};
  const fill = style.fillType === 'solid' ? hex(style.fgColor) : (style.fillType && style.fillType !== 'none' ? style.fillType : undefined);
  const border = (value: string | undefined) => (value && value !== 'none' ? value : undefined);
  return {
    'style:bold': yes(style.bold),
    'style:italic': yes(style.italic),
    'style:underline': yes(style.underline),
    'style:fontSize': style.fontSize ? `${style.fontSize} pt` : undefined,
    'style:fontColor': hex(style.fontColor),
    'style:fill': fill,
    'style:hAlign': style.hAlign && style.hAlign !== 'general' ? style.hAlign : undefined,
    'style:vAlign': style.vAlign && style.vAlign !== 'bottom' ? style.vAlign : undefined,
    'style:wrap': yes(style.wrapText),
    'style:numFmt': style.numFmtId ? String(style.numFmtId) : undefined,
    'style:borderLeft': border(style.borderLeft),
    'style:borderRight': border(style.borderRight),
    'style:borderTop': border(style.borderTop),
    'style:borderBottom': border(style.borderBottom),
  };
}

/** A cell's text, formula and look; a cell that names no style looks like the workbook's default one. */
function cellProps(cell: XlsxCell | undefined, defaultStyle: XlsxCellStyle | undefined): Props {
  if (!cell) return {};
  return { cellValue: cell.value, formula: cell.formula, ...cellStyleProps(cell.style ?? defaultStyle) };
}

function hasContent(cell: XlsxCell | undefined): boolean {
  return Boolean(cell && (cell.value !== '' || cell.formula));
}

function areaRef(area: XlsxArea): string {
  const start = `${colToLetter(area.startCol)}${area.startRow}`;
  const end = `${colToLetter(area.endCol)}${area.endRow}`;
  return start === end ? start : `${start}:${end}`;
}

// ─── Rows ───

function rowsByIndex(sheet: XlsxSheet | undefined): Map<number, Map<number, XlsxCell>> {
  const out = new Map<number, Map<number, XlsxCell>>();
  for (const row of sheet?.rows ?? []) out.set(row.index, new Map(row.cells.map(cell => [cell.col, cell])));
  return out;
}

function lastRow(sheet: XlsxSheet | undefined): number {
  let max = 0;
  for (const row of sheet?.rows ?? []) max = Math.max(max, row.index);
  for (const merge of sheet?.merges ?? []) max = Math.max(max, merge.endRow);
  return max;
}

/** What a row says: its texts and formulas by column — the look is left out, so a restyled row still lines up. */
function rowSignature(cells: Map<number, XlsxCell> | undefined): string {
  if (!cells) return '';
  const parts: string[] = [];
  for (const [col, cell] of [...cells].sort((a, b) => a[0] - b[0])) {
    if (hasContent(cell)) parts.push(`${col}=${cell.value}${cell.formula ? `|=${cell.formula}` : ''}`);
  }
  return parts.join('\u0001');
}

/**
 * How alike two rows are: a filled cell with the same text in the same column
 * counts fully, one filled in both but rewritten counts in part, the more the
 * closer the texts — a row whose only label was edited is still that row.
 */
function rowSimilarity(a: Map<number, XlsxCell> | undefined, b: Map<number, XlsxCell> | undefined): number {
  const filledA = [...(a?.values() ?? [])].filter(hasContent);
  const filledB = [...(b?.values() ?? [])].filter(hasContent);
  if (filledA.length === 0 && filledB.length === 0) return 1;
  let score = 0;
  for (const cell of filledA) {
    const twin = b?.get(cell.col);
    if (!twin || !hasContent(twin)) continue;
    score += twin.value === cell.value && twin.formula === cell.formula
      ? 1
      : 0.2 + 0.6 * textSimilarity(`${cell.value}${cell.formula ?? ''}`, `${twin.value}${twin.formula ?? ''}`);
  }
  return score / Math.max(filledA.length, filledB.length);
}

// ─── One sheet ───

interface SheetResult {
  comparison: SheetComparison;
  entries: DiffEntry[];
}

function emptyComparison(key: string, name: string, change: SheetComparison['change'], older?: XlsxSheet, newer?: XlsxSheet): SheetComparison {
  return {
    key, name, change, older, newer,
    olderToNewer: new Map(), newerToOlder: new Map(),
    olderMarks: new Map(), newerMarks: new Map(),
    olderRowMarks: new Map(), newerRowMarks: new Map(),
    cellChanges: [],
  };
}

/** The named ranges anchored in each row of a sheet — what ER binds that row's cells to. */
function namesByRow(workbook: XlsxWorkbook, sheet: XlsxSheet | undefined): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  if (!sheet) return out;
  for (const area of workbook.namedAreas) {
    if (area.sheet && area.sheet.toUpperCase() !== sheet.name.toUpperCase()) continue;
    const row = area.area.startRow;
    out.set(row, (out.get(row) ?? new Set()).add(area.name));
  }
  return out;
}

function compareSheets(
  key: string,
  older: XlsxSheet | undefined,
  newer: XlsxSheet | undefined,
  defaults: { older?: XlsxCellStyle; newer?: XlsxCellStyle },
  names: { older: Map<number, Set<string>>; newer: Map<number, Set<string>> } = { older: new Map(), newer: new Map() },
): SheetResult {
  const name = newer?.name ?? older?.name ?? '';
  const entryId = (kind: string, id: string) => `template:${key}:${kind}:${id}`;
  const entries: DiffEntry[] = [];
  const cellTarget = (olderRef?: string, newerRef?: string) => ({ sheet: key, olderRef, newerRef });

  // A whole sheet added or removed: one entry, every cell marked.
  if (!older || !newer) {
    const sheet = (newer ?? older)!;
    const change: ChangeKind = newer ? 'added' : 'removed';
    const comparison = emptyComparison(key, name, change, older, newer);
    const marks = newer ? comparison.newerMarks : comparison.olderMarks;
    const rowMarks = newer ? comparison.newerRowMarks : comparison.olderRowMarks;
    let filled = 0;
    for (const row of sheet.rows) {
      rowMarks.set(row.index, change);
      for (const cell of row.cells) {
        if (!hasContent(cell)) continue;
        filled++;
        marks.set(cell.ref, change);
      }
    }
    const props: Props = { name: sheet.name, cells: String(filled) };
    entries.push({
      id: entryId('sheet', change), change, itemKind: 'sheet', path: name,
      properties: Object.entries(props).map(([k, v]) => (newer ? { key: k, after: v } : { key: k, before: v })),
      templateCell: cellTarget(),
    });
    return { comparison, entries };
  }

  const comparison = emptyComparison(key, name, 'same', older, newer);
  if (older.name !== newer.name) {
    entries.push({
      id: entryId('sheet', 'name'), change: 'changed', itemKind: 'sheet', path: newer.name, previousPath: older.name,
      properties: [{ key: 'name', before: older.name, after: newer.name }],
      templateCell: cellTarget(),
    });
  }

  // Line the rows up by what they say.
  const olderRows = rowsByIndex(older);
  const newerRows = rowsByIndex(newer);
  const olderCount = lastRow(older);
  const newerCount = lastRow(newer);
  const signaturesA = Array.from({ length: olderCount }, (_, i) => rowSignature(olderRows.get(i + 1)));
  const signaturesB = Array.from({ length: newerCount }, (_, i) => rowSignature(newerRows.get(i + 1)));
  // A row whose cells ER writes through the same named range is the same row,
  // however much its labels were rewritten (a translated derivation).
  const sharesName = (a: number, b: number) => {
    const x = names.older.get(a + 1);
    const y = names.newer.get(b + 1);
    if (!x || !y) return false;
    for (const name of x) if (y.has(name)) return true;
    return false;
  };
  const aligned = alignSequences(signaturesA, signaturesB, {
    similarity: (a, b) => Math.max(rowSimilarity(olderRows.get(a + 1), newerRows.get(b + 1)), sharesName(a, b) ? 0.9 : 0),
    threshold: 0.34,
  });

  const cellEntry = (change: TemplateCellChange) => {
    const ref = change.newerRef ?? change.olderRef ?? '';
    entries.push({
      id: entryId('cell', `${change.olderRef ?? ''}>${change.newerRef ?? ''}`),
      change: change.change,
      itemKind: 'cell',
      path: `${name}/${ref}`,
      previousPath: change.olderRef && change.newerRef && change.olderRef !== change.newerRef ? `${older.name}/${change.olderRef}` : undefined,
      properties: change.properties,
      templateCell: cellTarget(change.olderRef, change.newerRef),
    });
    comparison.cellChanges.push(change);
  };

  const rowHeightsBefore: string[] = [];
  const rowHeightsAfter: string[] = [];

  for (const pair of aligned) {
    if (pair.kind === 'removed' || pair.kind === 'added') {
      const side = pair.kind === 'removed' ? 'older' : 'newer';
      const rowNo = (pair.kind === 'removed' ? pair.a : pair.b) + 1;
      const cells = (side === 'older' ? olderRows : newerRows).get(rowNo);
      const filled = [...(cells?.values() ?? [])].filter(hasContent).sort((x, y) => x.col - y.col);
      if (filled.length === 0) continue;
      (side === 'older' ? comparison.olderRowMarks : comparison.newerRowMarks).set(rowNo, pair.kind);
      for (const cell of filled) {
        (side === 'older' ? comparison.olderMarks : comparison.newerMarks).set(cell.ref, pair.kind);
        const props = cellProps(cell, side === 'older' ? defaults.older : defaults.newer);
        cellEntry({
          change: pair.kind,
          styleOnly: false,
          olderRef: side === 'older' ? cell.ref : undefined,
          newerRef: side === 'newer' ? cell.ref : undefined,
          // What the cell says; its look is part of the row that came or went.
          properties: Object.entries(props)
            .filter(([k, v]) => !k.startsWith('style:') && v != null && v !== '')
            .map(([k, v]) => (side === 'older' ? { key: k, before: v } : { key: k, after: v })),
        });
      }
      continue;
    }

    const rowA = pair.a + 1;
    const rowB = pair.b + 1;
    comparison.olderToNewer.set(rowA, rowB);
    comparison.newerToOlder.set(rowB, rowA);
    const cellsA = olderRows.get(rowA);
    const cellsB = newerRows.get(rowB);
    const heightA = older.rows.find(r => r.index === rowA)?.height;
    const heightB = newer.rows.find(r => r.index === rowB)?.height;
    if ((heightA ?? 0) !== (heightB ?? 0)) {
      rowHeightsBefore.push(`${rowB} = ${heightA ?? '—'}`);
      rowHeightsAfter.push(`${rowB} = ${heightB ?? '—'}`);
    }
    const columns = new Set<number>([...(cellsA?.keys() ?? []), ...(cellsB?.keys() ?? [])]);
    let rowChanged = false;
    for (const col of [...columns].sort((x, y) => x - y)) {
      const a = cellsA?.get(col);
      const b = cellsB?.get(col);
      const properties = diffProperties(cellProps(a, defaults.older), cellProps(b, defaults.newer));
      if (properties.length === 0) continue;
      const olderRef = `${colToLetter(col)}${rowA}`;
      const newerRef = `${colToLetter(col)}${rowB}`;
      const styleOnly = properties.every(p => p.key.startsWith('style:'));
      const change: ChangeKind = !hasContent(a) && hasContent(b) ? 'added' : hasContent(a) && !hasContent(b) ? 'removed' : 'changed';
      const mark: CellMark = styleOnly ? 'style' : change;
      comparison.olderMarks.set(olderRef, mark);
      comparison.newerMarks.set(newerRef, mark);
      if (!styleOnly) rowChanged = true;
      cellEntry({ change, styleOnly, olderRef, newerRef, properties });
    }
    if (rowChanged) {
      comparison.olderRowMarks.set(rowA, 'changed');
      comparison.newerRowMarks.set(rowB, 'changed');
    }
  }

  // Where an older row sits on the newer sheet — anything anchored to rows moves with them.
  const mapRow = (row: number): number | undefined => comparison.olderToNewer.get(row);
  const mapArea = (area: XlsxArea): XlsxArea | undefined => {
    const startRow = mapRow(area.startRow);
    const endRow = mapRow(area.endRow);
    return startRow != null && endRow != null ? { ...area, startRow, endRow } : undefined;
  };

  // Merged cells.
  const newerMerges = new Map(newer.merges.map(m => [m.ref.toUpperCase(), m]));
  const matchedMerges = new Set<string>();
  for (const merge of older.merges) {
    const moved = mapArea(merge);
    const key = moved ? areaRef(moved).toUpperCase() : undefined;
    if (key && newerMerges.has(key)) { matchedMerges.add(key); continue; }
    entries.push({
      id: entryId('merge', `-${merge.ref}`), change: 'removed', itemKind: 'merge', path: `${name}/${merge.ref}`,
      properties: [{ key: 'range', before: merge.ref }],
      templateCell: cellTarget(`${colToLetter(merge.startCol)}${merge.startRow}`, undefined),
    });
  }
  for (const [key, merge] of newerMerges) {
    if (matchedMerges.has(key)) continue;
    entries.push({
      id: entryId('merge', `+${merge.ref}`), change: 'added', itemKind: 'merge', path: `${name}/${merge.ref}`,
      properties: [{ key: 'range', after: merge.ref }],
      templateCell: cellTarget(undefined, `${colToLetter(merge.startCol)}${merge.startRow}`),
    });
  }

  // Pictures and text boxes, matched by the name Excel gave them.
  const drawingProps = (d: XlsxDrawing, area: XlsxArea | undefined): Props => ({
    drawingKind: d.dataUrl ? 'image' : 'textBox',
    text: d.text,
    position: area ? areaRef(area) : undefined,
    image: fingerprint(d.dataUrl),
  });
  const drawingArea = (d: XlsxDrawing): XlsxArea => ({
    startCol: d.from.col + 1,
    startRow: d.from.row + 1,
    endCol: (d.to?.col ?? d.from.col) + 1,
    endRow: (d.to?.row ?? d.from.row) + 1,
  });
  const drawingKey = (d: XlsxDrawing) => (d.name || `#${d.id}`).toLowerCase();
  const olderDrawings = [...older.images, ...older.textShapes];
  const newerDrawings = new Map([...newer.images, ...newer.textShapes].map(d => [drawingKey(d), d]));
  const seenDrawings = new Set<string>();
  for (const d of olderDrawings) {
    const key = drawingKey(d);
    const twin = newerDrawings.get(key);
    const label = d.name || `#${d.id}`;
    if (!twin) {
      entries.push({
        id: entryId('drawing', `-${key}`), change: 'removed', itemKind: 'drawing', path: `${name}/${label}`,
        properties: Object.entries(drawingProps(d, drawingArea(d))).filter(([, v]) => v).map(([k, v]) => ({ key: k, before: v })),
        templateCell: cellTarget(`${colToLetter(d.from.col + 1)}${d.from.row + 1}`, undefined),
      });
      continue;
    }
    seenDrawings.add(key);
    const properties = diffProperties(drawingProps(d, mapArea(drawingArea(d)) ?? drawingArea(d)), drawingProps(twin, drawingArea(twin)));
    if (properties.length === 0) continue;
    // A moved drawing reports where it was on the older sheet, not the row-mapped spot.
    for (const p of properties) if (p.key === 'position') p.before = areaRef(drawingArea(d));
    entries.push({
      id: entryId('drawing', key), change: 'changed', itemKind: 'drawing', path: `${name}/${twin.name || label}`,
      properties,
      templateCell: cellTarget(`${colToLetter(d.from.col + 1)}${d.from.row + 1}`, `${colToLetter(twin.from.col + 1)}${twin.from.row + 1}`),
    });
  }
  for (const [key, d] of newerDrawings) {
    if (seenDrawings.has(key)) continue;
    entries.push({
      id: entryId('drawing', `+${key}`), change: 'added', itemKind: 'drawing', path: `${name}/${d.name || `#${d.id}`}`,
      properties: Object.entries(drawingProps(d, drawingArea(d))).filter(([, v]) => v).map(([k, v]) => ({ key: k, after: v })),
      templateCell: cellTarget(undefined, `${colToLetter(d.from.col + 1)}${d.from.row + 1}`),
    });
  }

  // Column widths and row heights: one entry, item against item.
  const widths = (sheet: XlsxSheet) => {
    const items: string[] = [];
    for (const [col, width] of [...sheet.colWidths].sort((a, b) => a[0] - b[0])) items.push(`${colToLetter(col)} = ${Math.round(width * 100) / 100}`);
    return items.length > 0 ? items.join('\n') : undefined;
  };
  const layout: PropertyChange[] = [];
  const widthsBefore = widths(older);
  const widthsAfter = widths(newer);
  if (widthsBefore !== widthsAfter) layout.push({ key: 'columnWidths', before: widthsBefore, after: widthsAfter });
  if (rowHeightsBefore.length > 0) layout.push({ key: 'rowHeights', before: rowHeightsBefore.join('\n'), after: rowHeightsAfter.join('\n') });
  if (layout.length > 0) {
    entries.push({ id: entryId('layout', 'size'), change: 'changed', itemKind: 'layout', path: name, properties: layout, templateCell: cellTarget() });
  }

  if (entries.length > 0) comparison.change = 'changed';
  return { comparison, entries };
}

// ─── Named ranges ───

function namedKey(area: XlsxNamedArea): string {
  return `${area.name}|${(area.scopeSheet ?? '').toUpperCase()}`;
}

function namedRef(area: XlsxNamedArea, at: XlsxArea = area.area): string {
  return `${area.sheet ? `${area.sheet}!` : ''}${areaRef(at)}`;
}

/** Share of filled-cell texts two sheets have in common — whether a sheet under a new name is the old one. */
function sheetSimilarity(a: XlsxSheet, b: XlsxSheet): number {
  const texts = (sheet: XlsxSheet) => new Set(sheet.rows.flatMap(row => row.cells.filter(hasContent).map(cell => `${cell.col}|${cell.value}`)));
  const x = texts(a);
  const y = texts(b);
  if (x.size === 0 && y.size === 0) return 1;
  let same = 0;
  for (const text of x) if (y.has(text)) same++;
  return same / (x.size + y.size - same);
}

// ─── Entry point ───

export function compareWorkbooks(older: XlsxWorkbook, newer: XlsxWorkbook): WorkbookComparison {
  // Sheets pair by name, then — a renamed sheet — by position.
  const pairs: Array<[XlsxSheet | undefined, XlsxSheet | undefined]> = [];
  const newerByName = new Map(newer.sheets.map(sheet => [sheet.name.toLowerCase(), sheet]));
  const paired = new Set<XlsxSheet>();
  const leftOver: XlsxSheet[] = [];
  for (const sheet of older.sheets) {
    const twin = newerByName.get(sheet.name.toLowerCase());
    if (twin) { pairs.push([sheet, twin]); paired.add(twin); } else leftOver.push(sheet);
  }
  for (const sheet of leftOver) {
    const index = older.sheets.indexOf(sheet);
    const twin = newer.sheets[index];
    if (
      twin && !paired.has(twin)
      && !older.sheets.some(s => s.name.toLowerCase() === twin.name.toLowerCase())
      && sheetSimilarity(sheet, twin) >= 0.5
    ) {
      pairs.push([sheet, twin]);
      paired.add(twin);
    } else {
      pairs.push([sheet, undefined]);
    }
  }
  for (const sheet of newer.sheets) if (!paired.has(sheet)) pairs.push([undefined, sheet]);
  // In the newer workbook's order; a removed sheet after the one it used to follow.
  const order = (pair: [XlsxSheet | undefined, XlsxSheet | undefined]) => (pair[1]
    ? newer.sheets.indexOf(pair[1])
    : older.sheets.indexOf(pair[0]!) + 0.5);
  pairs.sort((x, y) => order(x) - order(y));

  const sheets: SheetComparison[] = [];
  const sections: DiffSection[] = [];
  pairs.forEach(([a, b], index) => {
    const key = `${index}`;
    const { comparison, entries } = compareSheets(
      key, a, b,
      { older: older.defaultStyle, newer: newer.defaultStyle },
      { older: namesByRow(older, a), newer: namesByRow(newer, b) },
    );
    sheets.push(comparison);
    if (entries.length > 0) sections.push({ id: `template:${key}`, kind: 'template', scope: comparison.name, entries });
  });

  // Named ranges: what ER's cells and ranges bind to. A range that only
  // moved with inserted rows is not a change.
  const sheetBy = (sheetName: string | undefined) => sheets.find(s => s.older && s.older.name.toUpperCase() === (sheetName ?? '').toUpperCase());
  const newerNames = new Map(newer.namedAreas.map(area => [namedKey(area), area]));
  const seen = new Set<string>();
  const nameEntries: DiffEntry[] = [];
  for (const area of older.namedAreas) {
    const key = namedKey(area);
    const twin = newerNames.get(key);
    const sheet = sheetBy(area.sheet);
    const sheetKey = sheet?.key ?? '';
    if (!twin) {
      nameEntries.push({
        id: `template:names:-${key}`, change: 'removed', itemKind: 'namedRange', path: area.name,
        properties: [{ key: 'range', before: namedRef(area) }],
        templateCell: { sheet: sheetKey, olderRef: area.anchor },
      });
      continue;
    }
    seen.add(key);
    const startRow = sheet?.olderToNewer.get(area.area.startRow);
    const endRow = sheet?.olderToNewer.get(area.area.endRow);
    const moved = startRow != null && endRow != null ? { ...area.area, startRow, endRow } : area.area;
    const sameSheet = (sheet?.newer?.name ?? area.sheet ?? '').toUpperCase() === (twin.sheet ?? '').toUpperCase();
    if (sameSheet && areaRef(moved) === areaRef(twin.area)) continue;
    const twinSheet = sheets.find(s => s.newer && s.newer.name.toUpperCase() === (twin.sheet ?? '').toUpperCase());
    nameEntries.push({
      id: `template:names:${key}`, change: 'changed', itemKind: 'namedRange', path: twin.name,
      properties: [{ key: 'range', before: namedRef(area), after: namedRef(twin) }],
      templateCell: { sheet: twinSheet?.key ?? sheetKey, olderRef: area.anchor, newerRef: twin.anchor },
    });
  }
  for (const [key, area] of newerNames) {
    if (seen.has(key)) continue;
    const sheet = sheets.find(s => s.newer && s.newer.name.toUpperCase() === (area.sheet ?? '').toUpperCase());
    nameEntries.push({
      id: `template:names:+${key}`, change: 'added', itemKind: 'namedRange', path: area.name,
      properties: [{ key: 'range', after: namedRef(area) }],
      templateCell: { sheet: sheet?.key ?? '', newerRef: area.anchor },
    });
  }
  if (nameEntries.length > 0) {
    sections.push({ id: 'template:names', kind: 'templateNames', entries: nameEntries.sort((x, y) => x.path.localeCompare(y.path)) });
  }

  const counts: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0 };
  for (const section of sections) for (const entry of section.entries) counts[entry.change] += 1;
  return { sheets, sections, counts };
}

/** Whether a template file is a workbook this module can read. */
export function isWorkbookTemplate(template: { filename: string; base64?: string } | undefined): boolean {
  if (!template?.base64) return false;
  // A zip starts with "PK" — `UEsD` in base64; the name may lack the extension.
  return /\.xls[xm]$/i.test(template.filename) || (template.base64.startsWith('UEsD') && !/\.docx$/i.test(template.filename));
}
