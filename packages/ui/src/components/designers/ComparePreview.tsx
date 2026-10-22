import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRepeatAllRegular,
  BranchForkRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  DocumentRegular,
  QuestionCircleRegular,
  TableRegular,
} from '@fluentui/react-icons';
import type { ERConfiguration, ERFormatContent, ERFormatElement } from '@er-visualizer/core';
import { useAppStore } from '../../state/store';
import { t } from '../../i18n';
import { useTabState } from '../../utils/tab-view-state';
import { colToLetter, type XlsxAnchorPoint, type XlsxDrawing, type XlsxSheet, type XlsxWorkbook } from '../../utils/xlsx-parser';
import type { CellMark, RowMark, SheetComparison, TemplateCellChange } from '../../utils/template-diff';
import { inlineChange, type ChangeKind, type PropertyChange, type VersionDiff } from '../../utils/version-diff';
import { buildFormatLineage } from '../../utils/format-lineage';
import { buildPreviewDocument, MAX_PREVIEW_LINES, type PreviewLine, type PreviewValueMode } from '../../utils/format-preview';
import { normalizeGuid } from '../../utils/format-binding-display';
import { alignSequences, foldUnchanged, textSimilarity } from '../../utils/sequence-diff';
import { detectFormatType, unwrapConverterRoot } from './format-type';
import type { TemplateComparisonState } from './useTemplateComparison';

type Side = 'older' | 'newer';

/** A place in the template the change list asked the preview to show. */
export interface TemplateFocus {
  sheet: string;
  olderRef?: string;
  newerRef?: string;
  /** Bumped on every request, so asking for the same cell again scrolls to it again. */
  nonce: number;
}

export interface ComparePreviewProps {
  diff: VersionDiff;
  configIndex: number;
  tabId: string;
  templates: TemplateComparisonState;
  focus: TemplateFocus | null;
  /** Column headings of the two sides (`Older · v12`). */
  sideLabels: Record<Side, string>;
  propertyLabel: (key: string) => string;
  displayValue: (key: string, value: string | undefined, side: Side) => string | undefined;
}

/**
 * The two versions' output side by side: the Excel template as a grid with
 * every changed cell coloured, or — for an XML or text format — the sample
 * document each version writes, line against line.
 */
export function ComparePreview(props: ComparePreviewProps) {
  const { diff, templates } = props;
  if (diff.older.content.kind !== 'Format') return <p className="vcmp-empty">{t.comparePreviewFormatsOnly}</p>;
  if (templates.status === 'loading') return <p className="vcmp-empty">{t.comparePreviewLoading}</p>;
  if (templates.status === 'error') return <p className="vcmp-empty">{t.comparePreviewTemplateError(templates.message)}</p>;
  if (templates.status === 'ready') {
    return (
      <TemplateCompare
        {...props}
        olderWorkbook={templates.older}
        newerWorkbook={templates.newer}
        sheets={templates.comparison.sheets}
        files={{ older: templates.olderFile, newer: templates.newerFile }}
      />
    );
  }
  return <DocumentCompare {...props} />;
}

// ─── Excel template ───────────────────────────────────────────────────────

/** An ER element that writes into a cell of the template. */
interface BoundElement {
  id: string;
  name: string;
  type: string;
  /** How the element changed between the versions, when it did. */
  change?: ChangeKind;
}

const HEADER_H = 20;
const GUTTER_W = 36;
const DEFAULT_ROW_H = 20;
const EMU_PER_PX = 9525;
const MAX_COLS = 40;
const MAX_ROWS = 400;

interface SheetGeometry {
  maxCol: number;
  maxRow: number;
  colWidth: (col: number) => number;
  rowHeight: (row: number) => number;
  colX: (col: number) => number;
  rowY: (row: number) => number;
  /** The row whose band holds `y` (table coordinates). */
  rowAt: (y: number) => number;
  width: number;
  height: number;
}

function sheetGeometry(sheet: XlsxSheet | undefined, minRows = 0, minCols = 0): SheetGeometry {
  let maxCol = minCols;
  let maxRow = minRows;
  for (const row of sheet?.rows ?? []) {
    maxRow = Math.max(maxRow, row.index);
    for (const cell of row.cells) maxCol = Math.max(maxCol, cell.col);
  }
  for (const merge of sheet?.merges ?? []) {
    maxCol = Math.max(maxCol, merge.endCol);
    maxRow = Math.max(maxRow, merge.endRow);
  }
  for (const d of [...(sheet?.images ?? []), ...(sheet?.textShapes ?? [])]) {
    maxCol = Math.max(maxCol, (d.to?.col ?? d.from.col) + 1);
    maxRow = Math.max(maxRow, (d.to?.row ?? d.from.row) + 1);
  }
  maxCol = Math.min(Math.max(maxCol, 1), MAX_COLS);
  maxRow = Math.min(Math.max(maxRow, 1), MAX_ROWS);
  const heights = new Map<number, number>();
  for (const row of sheet?.rows ?? []) if (row.height && row.height > 0) heights.set(row.index, Math.max(6, Math.round(row.height * (96 / 72))));
  const colWidth = (col: number) => {
    const w = sheet?.colWidths.get(col);
    return w ? Math.max(24, Math.round(w * 7.5)) : 64;
  };
  const rowHeight = (row: number) => heights.get(row) ?? DEFAULT_ROW_H;
  const xs = [GUTTER_W];
  for (let c = 1; c <= maxCol + 1; c++) xs.push(xs[c - 1] + colWidth(c));
  const ys = [HEADER_H];
  for (let r = 1; r <= maxRow + 1; r++) ys.push(ys[r - 1] + rowHeight(r));
  const colX = (col: number) => xs[Math.min(Math.max(col - 1, 0), xs.length - 1)];
  const rowY = (row: number) => ys[Math.min(Math.max(row - 1, 0), ys.length - 1)];
  const rowAt = (y: number) => {
    let lo = 0;
    let hi = maxRow;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ys[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return Math.min(maxRow, lo + 1);
  };
  return { maxCol, maxRow, colWidth, rowHeight, colX, rowY, rowAt, width: colX(maxCol + 1), height: rowY(maxRow + 1) };
}

function refCoords(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/**
 * The cells each ER element of one side writes to, by sheet: an Excel cell or
 * range element names a named range (or a plain address) of its sheet.
 */
function boundCells(cfg: ERConfiguration, workbook: XlsxWorkbook | null, changes: Map<string, ChangeKind>): Map<string, Map<string, BoundElement[]>> {
  const out = new Map<string, Map<string, BoundElement[]>>();
  if (!workbook || cfg.content.kind !== 'Format') return out;
  const root = (cfg.content as ERFormatContent).formatVersion?.format?.rootElement;
  if (!root) return out;
  const add = (sheetName: string, ref: string, element: BoundElement) => {
    const key = sheetName.toUpperCase();
    const cells = out.get(key) ?? new Map<string, BoundElement[]>();
    cells.set(ref, [...(cells.get(ref) ?? []), element]);
    out.set(key, cells);
  };
  const walk = (el: ERFormatElement, sheet: string | undefined) => {
    let current = sheet;
    if (el.elementType === 'ExcelSheet') current = el.attributes?.['ExcelRange'] || el.name;
    if (el.elementType === 'ExcelCell' || el.elementType === 'ExcelRange') {
      const range = (el.attributes?.['ExcelRange'] || el.name || '').toUpperCase();
      const element: BoundElement = { id: el.id, name: el.name, type: el.elementType, change: changes.get(normalizeGuid(el.id)) };
      const area = workbook.namedAreas.find(n => n.name === range && (!n.sheet || !current || n.sheet.toUpperCase() === current.toUpperCase()))
        ?? workbook.namedAreas.find(n => n.name === range);
      const sheetName = area?.sheet ?? current ?? workbook.sheets[0]?.name ?? '';
      if (area) {
        const { startCol, startRow, endCol, endRow } = area.area;
        // A range element over a whole block marks its cells only while that stays readable.
        if ((endCol - startCol + 1) * (endRow - startRow + 1) <= 400) {
          for (let r = startRow; r <= endRow; r++) for (let c = startCol; c <= endCol; c++) add(sheetName, `${colToLetter(c)}${r}`, element);
        }
      } else if (refCoords(range)) {
        add(sheetName, range, element);
      }
    }
    for (const child of el.children ?? []) walk(child, current);
  };
  walk(root, undefined);
  return out;
}

/** Changed format elements of one side, by GUID, from the structure section of the diff. */
function elementChanges(diff: VersionDiff, side: Side): Map<string, ChangeKind> {
  const out = new Map<string, ChangeKind>();
  for (const section of diff.sections) {
    if (section.kind !== 'structure') continue;
    for (const entry of section.entries) {
      const locate = side === 'older' ? entry.locateOlder : entry.locateNewer;
      if (entry.itemKind === 'element' && locate?.type === 'formatElement') out.set(normalizeGuid(locate.id), entry.change);
    }
  }
  return out;
}

interface CellStop {
  olderRef?: string;
  newerRef?: string;
}

function TemplateCompare({ diff, sideLabels, focus, olderWorkbook, newerWorkbook, sheets, files, propertyLabel, displayValue }: ComparePreviewProps & {
  olderWorkbook: XlsxWorkbook | null;
  newerWorkbook: XlsxWorkbook | null;
  sheets: SheetComparison[];
  files: Record<Side, string | undefined>;
}) {
  const firstChanged = sheets.find(s => s.change !== 'same')?.key ?? sheets[0]?.key;
  const [sheetKey, setSheetKey] = useState<string | undefined>(focus?.sheet || firstChanged);
  const [selected, setSelected] = useState<CellStop | null>(focus ? { olderRef: focus.olderRef, newerRef: focus.newerRef } : null);
  const sheet = sheets.find(s => s.key === sheetKey) ?? sheets[0];

  const bound = useMemo(() => ({
    older: boundCells(diff.older, olderWorkbook, elementChanges(diff, 'older')),
    newer: boundCells(diff.newer, newerWorkbook, elementChanges(diff, 'newer')),
  }), [diff, olderWorkbook, newerWorkbook]);
  const olderBound = sheet?.older ? bound.older.get(sheet.older.name.toUpperCase()) : undefined;
  const newerBound = sheet?.newer ? bound.newer.get(sheet.newer.name.toUpperCase()) : undefined;

  // Both grids get the same number of rows, so they scroll the same distance.
  const rows = Math.max(sheetGeometry(sheet?.older).maxRow, sheetGeometry(sheet?.newer).maxRow);
  const olderGeo = useMemo(() => sheetGeometry(sheet?.older, rows), [sheet, rows]);
  const newerGeo = useMemo(() => sheetGeometry(sheet?.newer, rows), [sheet, rows]);

  // Where to stop on "next change": edited cells, then cells whose ER element changed.
  const stops = useMemo<CellStop[]>(() => {
    if (!sheet) return [];
    const list: Array<CellStop & { order: number }> = [];
    const orderOf = (stop: CellStop) => {
      const n = stop.newerRef ? refCoords(stop.newerRef) : null;
      if (n) return n.row * 1000 + n.col;
      const o = stop.olderRef ? refCoords(stop.olderRef) : null;
      if (!o) return 0;
      let row = o.row;
      while (row > 0 && !sheet.olderToNewer.has(row)) row--;
      return (row > 0 ? sheet.olderToNewer.get(row)! : 0) * 1000 + 500 + o.col;
    };
    const seen = new Set<string>();
    for (const change of sheet.cellChanges) {
      const stop = { olderRef: change.olderRef, newerRef: change.newerRef };
      seen.add(`${stop.olderRef ?? ''}|${stop.newerRef ?? ''}`);
      list.push({ ...stop, order: orderOf(stop) });
    }
    const addBound = (cells: Map<string, BoundElement[]> | undefined, side: Side) => {
      for (const [ref, elements] of cells ?? []) {
        if (!elements.some(e => e.change)) continue;
        const coords = refCoords(ref)!;
        const twinRow = (side === 'newer' ? sheet.newerToOlder : sheet.olderToNewer).get(coords.row);
        const twin = twinRow != null ? `${colToLetter(coords.col)}${twinRow}` : undefined;
        const stop = side === 'newer' ? { newerRef: ref, olderRef: twin } : { olderRef: ref, newerRef: twin };
        const key = `${stop.olderRef ?? ''}|${stop.newerRef ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ ...stop, order: orderOf(stop) });
      }
    };
    addBound(newerBound, 'newer');
    addBound(olderBound, 'older');
    return list.sort((a, b) => a.order - b.order).map(({ order: _order, ...stop }) => stop);
  }, [sheet, olderBound, newerBound]);

  const olderScroll = useRef<HTMLDivElement>(null);
  const newerScroll = useRef<HTMLDivElement>(null);
  const [sync, setSync] = useState(true);
  const lock = useRef<Side | null>(null);

  /** Keep the other grid on the same rows — its twin rows, when rows were inserted on one side. */
  const onScroll = useCallback((side: Side) => {
    if (!sync || !sheet) return;
    if (lock.current && lock.current !== side) return;
    const src = side === 'older' ? olderScroll.current : newerScroll.current;
    const dst = side === 'older' ? newerScroll.current : olderScroll.current;
    if (!src || !dst) return;
    const srcGeo = side === 'older' ? olderGeo : newerGeo;
    const dstGeo = side === 'older' ? newerGeo : olderGeo;
    const map = side === 'older' ? sheet.olderToNewer : sheet.newerToOlder;
    const y = src.scrollTop + HEADER_H;
    const row = srcGeo.rowAt(y);
    let anchor = row;
    while (anchor > 0 && !map.has(anchor)) anchor--;
    const offset = y - srcGeo.rowY(anchor > 0 ? anchor : 1);
    const target = anchor > 0 ? dstGeo.rowY(map.get(anchor)!) + offset - HEADER_H : src.scrollTop;
    lock.current = side;
    dst.scrollTop = target;
    dst.scrollLeft = src.scrollLeft;
    requestAnimationFrame(() => { lock.current = null; });
  }, [sync, sheet, olderGeo, newerGeo]);

  const reveal = useCallback((stop: CellStop) => {
    setSelected(stop);
    // Both sides at once: the scroll sync would otherwise pull the other one to a mapped row.
    lock.current = 'older';
    const panes = [[olderScroll.current, stop.olderRef], [newerScroll.current, stop.newerRef]] as const;
    let placed: { top: number; left: number } | null = null;
    for (const [el, ref] of panes) {
      const cell = ref ? el?.querySelector<HTMLElement>(`[data-ref="${ref}"]`) : null;
      if (!el || !cell) continue;
      // The row in the middle, like a diff editor; sideways only when the cell is out of view.
      const top = Math.max(0, cell.offsetTop - el.clientHeight / 2 + cell.offsetHeight / 2);
      const visibleLeft = el.scrollLeft + GUTTER_W;
      const outside = cell.offsetLeft < visibleLeft || cell.offsetLeft + Math.min(cell.offsetWidth, el.clientWidth - GUTTER_W) > el.scrollLeft + el.clientWidth;
      const left = outside ? Math.max(0, cell.offsetLeft - GUTTER_W - 24) : el.scrollLeft;
      el.scrollTo({ top, left });
      placed ??= { top, left };
    }
    // A cell only one side has (a row that came or went): the other side keeps level with it.
    if (placed) {
      for (const [el, ref] of panes) {
        if (el && !(ref && el.querySelector(`[data-ref="${ref}"]`))) el.scrollTo(placed);
      }
    }
    requestAnimationFrame(() => { requestAnimationFrame(() => { lock.current = null; }); });
  }, []);

  // A focus request from the change list: its sheet, then its cell.
  const pendingFocus = useRef<TemplateFocus | null>(focus);
  useEffect(() => {
    if (!focus) return;
    pendingFocus.current = focus;
    if (focus.sheet) setSheetKey(focus.sheet);
  }, [focus]);
  useLayoutEffect(() => {
    const request = pendingFocus.current;
    if (!request || (request.sheet && request.sheet !== sheet?.key)) return;
    pendingFocus.current = null;
    if (request.olderRef || request.newerRef) reveal({ olderRef: request.olderRef, newerRef: request.newerRef });
  });

  const stopIndex = selected
    ? stops.findIndex(s => (selected.newerRef && s.newerRef === selected.newerRef) || (!selected.newerRef && s.olderRef === selected.olderRef))
    : -1;
  const step = (delta: number) => {
    if (stops.length === 0) return;
    const next = stopIndex < 0 ? (delta > 0 ? 0 : stops.length - 1) : (stopIndex + delta + stops.length) % stops.length;
    reveal(stops[next]);
  };

  const pick = (side: Side, ref: string) => {
    const coords = refCoords(ref);
    if (!coords || !sheet) return;
    const twinRow = (side === 'older' ? sheet.olderToNewer : sheet.newerToOlder).get(coords.row);
    const twin = twinRow != null ? `${colToLetter(coords.col)}${twinRow}` : undefined;
    setSelected(side === 'older' ? { olderRef: ref, newerRef: twin } : { newerRef: ref, olderRef: twin });
  };

  if (!sheet) return <p className="vcmp-empty">{t.comparePreviewNoSheets}</p>;
  const selectedChange = selected
    ? sheet.cellChanges.find(c => (selected.newerRef ? c.newerRef === selected.newerRef : c.olderRef === selected.olderRef))
      ?? sheet.cellChanges.find(c => selected.olderRef && c.olderRef === selected.olderRef)
    : undefined;

  return (
    <div className="tcmp">
      <div className="tcmp__bar">
        <div className="tcmp__sheets" role="tablist" aria-label={t.comparePreviewSheets}>
          {sheets.map(s => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === sheet.key}
              className={`tcmp__sheet tcmp__sheet--${s.change}${s.key === sheet.key ? ' active' : ''}`}
              onClick={() => { setSheetKey(s.key); setSelected(null); }}
              title={s.change === 'same' ? s.name : `${s.name} · ${t.compareChangeLabels[s.change]}`}
            >
              <TableRegular fontSize={13} aria-hidden />
              <span>{s.name}</span>
              {s.change !== 'same' && <span className={`tcmp__dot tcmp__dot--${s.change}`} aria-hidden />}
            </button>
          ))}
        </div>
        <div className="tcmp__nav">
          <span className="tcmp__count">
            {stops.length === 0 ? t.comparePreviewNoCellChanges : t.comparePreviewChangeOf(Math.max(stopIndex + 1, 0), stops.length)}
          </span>
          <button type="button" className="tcmp__navbtn" onClick={() => step(-1)} disabled={stops.length === 0} title={t.comparePreviewPrevChange} aria-label={t.comparePreviewPrevChange}>
            <ChevronUpRegular fontSize={14} />
          </button>
          <button type="button" className="tcmp__navbtn" onClick={() => step(1)} disabled={stops.length === 0} title={t.comparePreviewNextChange} aria-label={t.comparePreviewNextChange}>
            <ChevronDownRegular fontSize={14} />
          </button>
          <label className="tcmp__sync">
            <input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />
            {t.comparePreviewSyncScroll}
          </label>
        </div>
      </div>
      <div className="tcmp__panes">
        {(['older', 'newer'] as const).map(side => (
          <div key={side} className={`tcmp__pane tcmp__pane--${side}`}>
            <div className="tcmp__pane-head">
              <span className="tcmp__pane-label">{sideLabels[side]}</span>
              {files[side] && <span className="tcmp__pane-file" title={files[side]}><DocumentRegular fontSize={12} aria-hidden /> {files[side]}</span>}
            </div>
            <div
              ref={side === 'older' ? olderScroll : newerScroll}
              className="tcmp__scroll"
              onScroll={() => onScroll(side)}
            >
              {(side === 'older' ? sheet.older : sheet.newer) ? (
                <CompareSheetGrid
                  sheet={(side === 'older' ? sheet.older : sheet.newer)!}
                  geometry={side === 'older' ? olderGeo : newerGeo}
                  marks={side === 'older' ? sheet.olderMarks : sheet.newerMarks}
                  rowMarks={side === 'older' ? sheet.olderRowMarks : sheet.newerRowMarks}
                  bound={side === 'older' ? olderBound : newerBound}
                  selectedRef={side === 'older' ? selected?.olderRef : selected?.newerRef}
                  onPick={ref => pick(side, ref)}
                />
              ) : (
                <p className="tcmp__missing">{side === 'older' ? t.comparePreviewSheetAdded : t.comparePreviewSheetRemoved}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <CellDetail
        selected={selected}
        change={selectedChange}
        olderBound={selected?.olderRef ? olderBound?.get(selected.olderRef) : undefined}
        newerBound={selected?.newerRef ? newerBound?.get(selected.newerRef) : undefined}
        propertyLabel={propertyLabel}
        displayValue={displayValue}
      />
      <div className="tcmp__legend" aria-hidden>
        <span><i className="tcmp-swatch tcmp-swatch--added" />{t.compareChangeLabels.added}</span>
        <span><i className="tcmp-swatch tcmp-swatch--removed" />{t.compareChangeLabels.removed}</span>
        <span><i className="tcmp-swatch tcmp-swatch--changed" />{t.compareChangeLabels.changed}</span>
        <span><i className="tcmp-swatch tcmp-swatch--style" />{t.comparePreviewStyleOnly}</span>
        <span><i className="tcmp-swatch tcmp-swatch--bound" />{t.comparePreviewBoundChanged}</span>
      </div>
    </div>
  );
}

const MARK_TITLE: Record<CellMark, () => string> = {
  added: () => t.compareChangeLabels.added,
  removed: () => t.compareChangeLabels.removed,
  changed: () => t.compareChangeLabels.changed,
  style: () => t.comparePreviewStyleOnly,
};

/** One side's sheet as Excel draws it, with the comparison's marks over it. */
const CompareSheetGrid = React.memo(function CompareSheetGrid({ sheet, geometry, marks, rowMarks, bound, selectedRef, onPick }: {
  sheet: XlsxSheet;
  geometry: SheetGeometry;
  marks: Map<string, CellMark>;
  rowMarks: Map<number, RowMark>;
  bound: Map<string, BoundElement[]> | undefined;
  selectedRef: string | undefined;
  onPick: (ref: string) => void;
}) {
  const { maxCol, maxRow, colWidth, rowHeight, colX, rowY } = geometry;
  const cells = useMemo(() => {
    const map = new Map<string, XlsxSheet['rows'][number]['cells'][number]>();
    for (const row of sheet.rows) for (const cell of row.cells) map.set(cell.ref, cell);
    return map;
  }, [sheet]);
  const { anchors, covered } = useMemo(() => {
    const anchorMap = new Map<string, { colSpan: number; rowSpan: number }>();
    const coveredSet = new Set<string>();
    for (const m of sheet.merges) {
      const anchor = `${colToLetter(m.startCol)}${m.startRow}`;
      anchorMap.set(anchor, { colSpan: m.endCol - m.startCol + 1, rowSpan: m.endRow - m.startRow + 1 });
      for (let r = m.startRow; r <= m.endRow; r++) for (let c = m.startCol; c <= m.endCol; c++) {
        const ref = `${colToLetter(c)}${r}`;
        if (ref !== anchor) coveredSet.add(ref);
      }
    }
    return { anchors: anchorMap, covered: coveredSet };
  }, [sheet]);

  const anchorPx = (a: XlsxAnchorPoint) => ({ x: colX(a.col + 1) + a.colOff / EMU_PER_PX, y: rowY(a.row + 1) + a.rowOff / EMU_PER_PX });
  const box = (d: XlsxDrawing) => {
    const start = anchorPx(d.from);
    if (d.to) {
      const end = anchorPx(d.to);
      return { left: start.x, top: start.y, width: Math.max(1, end.x - start.x), height: Math.max(1, end.y - start.y) };
    }
    return { left: start.x, top: start.y, width: Math.max(1, (d.ext?.cx ?? 0) / EMU_PER_PX), height: Math.max(1, (d.ext?.cy ?? 0) / EMU_PER_PX) };
  };
  const cols = Array.from({ length: maxCol }, (_, i) => i + 1);
  const selected = selectedRef ? refCoords(selectedRef) : null;

  return (
    <div className="tcmp-grid" style={{ width: geometry.width, minHeight: geometry.height }}>
      <table className="tcmp-table">
        <colgroup>
          <col style={{ width: GUTTER_W }} />
          {cols.map(c => <col key={c} style={{ width: colWidth(c) }} />)}
        </colgroup>
        <thead>
          <tr style={{ height: HEADER_H }}>
            <th className="tcmp-corner" />
            {cols.map(c => (
              <th key={c} className={`tcmp-colhead${selected?.col === c ? ' active' : ''}`}>{colToLetter(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRow }, (_, i) => i + 1).map(row => {
            const rowMark = rowMarks.get(row);
            return (
              <tr key={row} style={{ height: rowHeight(row) }}>
                <td className={`tcmp-rowhead${rowMark ? ` tcmp-rowhead--${rowMark}` : ''}${selected?.row === row ? ' active' : ''}`}>{row}</td>
                {cols.map(col => {
                  const ref = `${colToLetter(col)}${row}`;
                  if (covered.has(ref)) return null;
                  const span = anchors.get(ref);
                  const cell = cells.get(ref);
                  const style = cell?.style;
                  const mark = marks.get(ref);
                  const elements = bound?.get(ref);
                  const boundChange = elements?.find(e => e.change)?.change;
                  const fill = style?.fillType === 'solid' && style.fgColor ? `#${style.fgColor.slice(-6)}` : undefined;
                  const text = cell?.value || (cell?.formula ? `=${cell.formula}` : '');
                  // The cell's own element names it better than the range repeating around it.
                  const writer = elements?.find(e => e.type === 'ExcelCell') ?? elements?.[0];
                  const placeholder = !text && writer ? `‹${writer.name}›` : '';
                  const title = [
                    ref,
                    text || undefined,
                    mark ? MARK_TITLE[mark]() : undefined,
                    ...(elements ?? []).map(e => `${e.name}${e.change ? ` · ${t.compareChangeLabels[e.change]}` : ''}`),
                  ].filter(Boolean).join('\n');
                  return (
                    <td
                      key={col}
                      data-ref={ref}
                      colSpan={span && span.colSpan > 1 ? span.colSpan : undefined}
                      rowSpan={span && span.rowSpan > 1 ? span.rowSpan : undefined}
                      className={[
                        'tcmp-cell',
                        mark ? `tcmp-cell--${mark}` : '',
                        elements?.length ? 'tcmp-cell--bound' : '',
                        boundChange ? 'tcmp-cell--bound-changed' : '',
                        selectedRef === ref ? 'tcmp-cell--selected' : '',
                      ].filter(Boolean).join(' ')}
                      title={title}
                      onClick={() => onPick(ref)}
                      style={{
                        background: fill,
                        color: style?.fontColor ? `#${style.fontColor.slice(-6)}` : undefined,
                        fontWeight: style?.bold ? 700 : undefined,
                        fontStyle: style?.italic ? 'italic' : undefined,
                        textDecoration: style?.underline ? 'underline' : undefined,
                        fontSize: style?.fontSize ? `${style.fontSize}pt` : undefined,
                        whiteSpace: style?.wrapText ? 'normal' : 'nowrap',
                        textAlign: style?.hAlign === 'center' || style?.hAlign === 'centerContinuous' ? 'center' : style?.hAlign === 'right' ? 'right' : undefined,
                        verticalAlign: style?.vAlign === 'top' ? 'top' : style?.vAlign === 'center' ? 'middle' : 'bottom',
                        borderTop: style?.borderTop ? '1px solid #8a8a8a' : undefined,
                        borderLeft: style?.borderLeft ? '1px solid #8a8a8a' : undefined,
                        borderRight: style?.borderRight ? '1px solid #8a8a8a' : undefined,
                        borderBottom: style?.borderBottom ? '1px solid #8a8a8a' : undefined,
                      }}
                    >
                      {text || (placeholder && <span className="tcmp-cell__placeholder">{placeholder}</span>)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {(sheet.images.length > 0 || sheet.textShapes.length > 0) && (
        <div className="tcmp-drawings" aria-hidden>
          {sheet.images.map(img => {
            const b = box(img);
            return <img key={`img-${img.id}`} src={img.dataUrl} alt="" title={img.name} style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />;
          })}
          {sheet.textShapes.map(shape => {
            const b = box(shape);
            return (
              <div
                key={`txt-${shape.id}`}
                className="tcmp-drawings__text"
                style={{
                  left: b.left, top: b.top, width: b.width, height: b.height,
                  justifyContent: shape.align === 'ctr' ? 'center' : shape.align === 'r' ? 'flex-end' : 'flex-start',
                  fontSize: shape.fontSize ? `${shape.fontSize}pt` : undefined,
                  fontWeight: shape.bold ? 700 : undefined,
                  color: shape.color ? `#${shape.color}` : undefined,
                }}
              >
                {shape.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

/** The selected cell: where it is on each side, which ER elements write to it, and what changed in it. */
function CellDetail({ selected, change, olderBound, newerBound, propertyLabel, displayValue }: {
  selected: CellStop | null;
  change: TemplateCellChange | undefined;
  olderBound: BoundElement[] | undefined;
  newerBound: BoundElement[] | undefined;
  propertyLabel: (key: string) => string;
  displayValue: (key: string, value: string | undefined, side: Side) => string | undefined;
}) {
  if (!selected) return <div className="tcmp-detail tcmp-detail--hint">{t.comparePreviewPickCell}</div>;
  const elements = new Map<string, BoundElement>();
  for (const e of [...(olderBound ?? []), ...(newerBound ?? [])]) {
    const key = normalizeGuid(e.id) || e.name;
    const known = elements.get(key);
    if (!known || (!known.change && e.change)) elements.set(key, e);
  }
  const value = (p: PropertyChange, side: Side) => displayValue(p.key, side === 'older' ? p.before : p.after, side) ?? '—';
  return (
    <div className="tcmp-detail">
      <span className="tcmp-detail__ref">
        {selected.olderRef && selected.newerRef && selected.olderRef !== selected.newerRef
          ? `${selected.olderRef} → ${selected.newerRef}`
          : (selected.newerRef ?? selected.olderRef)}
      </span>
      {change ? (
        <span className={`tcmp-detail__change vcmp-mark--${change.change}`}>
          {change.styleOnly ? t.comparePreviewStyleOnly : t.compareChangeLabels[change.change]}
        </span>
      ) : (
        <span className="tcmp-detail__same">{t.comparePreviewCellSame}</span>
      )}
      {change?.properties.map(p => (
        <span key={p.key} className="tcmp-detail__prop">
          <span className="tcmp-detail__key">{propertyLabel(p.key)}:</span>
          <span className="tcmp-detail__before">{value(p, 'older')}</span>
          <span aria-hidden>→</span>
          <span className="tcmp-detail__after">{value(p, 'newer')}</span>
        </span>
      ))}
      {[...elements.values()].map(e => (
        <span key={e.id || e.name} className="tcmp-detail__element" title={e.type}>
          {t.comparePreviewWrittenBy} <strong>{e.name}</strong>
          {e.change && <span className={`vcmp-mark--${e.change}`}> · {t.compareChangeLabels[e.change]}</span>}
        </span>
      ))}
    </div>
  );
}

// ─── XML / text document ──────────────────────────────────────────────────

const DOC_MODES: PreviewValueMode[] = ['sample', 'name', 'expression', 'source'];
const DOC_CONTEXT = 3;
/** Rows drawn before "show more" — the document can run to thousands of lines. */
const DOC_PAGE = 1500;

interface DocRow {
  kind: 'same' | 'changed' | 'added' | 'removed';
  older?: { line: PreviewLine; text: string; number?: number };
  newer?: { line: PreviewLine; text: string; number?: number };
}

/** What a line is compared by: its text as written, an annotation by its kind and text. */
function lineText(line: PreviewLine, kind: 'xml' | 'text' | 'other'): string {
  if (line.note) return `§ ${line.note.text}`;
  return `${kind === 'xml' ? '  '.repeat(line.indent) : ''}${line.segments.map(s => s.text).join('')}`;
}

function DocumentCompare({ diff, configIndex, tabId, sideLabels }: ComparePreviewProps) {
  const configurations = useAppStore(s => s.configurations);
  const [mode, setMode] = useTabState<PreviewValueMode>(tabId, 'compare.preview.mode', 'sample');
  const [limit, setLimit] = useState(DOC_PAGE);
  const [unfolded, setUnfolded] = useState<Set<number>>(() => new Set());
  const [current, setCurrent] = useState(-1);

  const docs = useMemo(() => {
    const build = (cfg: ERConfiguration) => {
      if (cfg.content.kind !== 'Format') return null;
      // The other version resolves against the same model and mapping as the loaded one.
      const configs = configurations[configIndex] === cfg ? configurations : configurations.map((c, i) => (i === configIndex ? cfg : c));
      const lineage = buildFormatLineage(configs, configIndex);
      const root = unwrapConverterRoot((cfg.content as ERFormatContent).formatVersion.format.rootElement);
      const label = detectFormatType(root).label;
      const kind = label === 'XML' ? 'xml' : label === 'Text / CSV' || label === 'Text' ? 'text' : null;
      if (!lineage || !kind) return null;
      return buildPreviewDocument(lineage, root, kind, { mode, iterations: 1, hideUnbound: false }, {
        repeats: t.docPreviewRepeats,
        condition: t.docPreviewCondition,
        optional: t.docPreviewOptional,
      });
    };
    return { older: build(diff.older), newer: build(diff.newer) };
  }, [configurations, configIndex, diff, mode]);

  const rows = useMemo<DocRow[]>(() => {
    const { older, newer } = docs;
    if (!older || !newer) return [];
    const number = (lines: PreviewLine[]) => {
      let n = 0;
      return lines.map(line => (line.note ? undefined : ++n));
    };
    const olderNo = number(older.lines);
    const newerNo = number(newer.lines);
    const a = older.lines.map(line => lineText(line, older.kind));
    const b = newer.lines.map(line => lineText(line, newer.kind));
    return alignSequences(a, b, { similarity: (i, j) => textSimilarity(a[i], b[j]), threshold: 0.45 }).map(pair => ({
      kind: pair.kind,
      older: pair.kind !== 'added' ? { line: older.lines[pair.a], text: a[pair.a], number: olderNo[pair.a] } : undefined,
      newer: pair.kind !== 'removed' ? { line: newer.lines[pair.b], text: b[pair.b], number: newerNo[pair.b] } : undefined,
    }));
  }, [docs]);

  const items = useMemo(() => foldUnchanged(rows, DOC_CONTEXT), [rows]);
  // Each run of changed rows is one stop for "next change".
  const blocks = useMemo(() => {
    const starts: number[] = [];
    items.forEach((item, index) => {
      if (item.kind !== 'row' || item.row.kind === 'same') return;
      const prev = items[index - 1];
      if (!prev || prev.kind !== 'row' || prev.row.kind === 'same') starts.push(index);
    });
    return starts;
  }, [items]);
  const bodyRef = useRef<HTMLDivElement>(null);

  if (!docs.older || !docs.newer) return <p className="vcmp-empty">{t.comparePreviewNoDocument}</p>;
  const changed = rows.filter(r => r.kind !== 'same').length;

  const go = (delta: number) => {
    if (blocks.length === 0) return;
    const next = current < 0 ? (delta > 0 ? 0 : blocks.length - 1) : (current + delta + blocks.length) % blocks.length;
    setCurrent(next);
    if (blocks[next] >= limit) setLimit(blocks[next] + DOC_PAGE);
    requestAnimationFrame(() => {
      bodyRef.current?.querySelector<HTMLElement>(`[data-item="${blocks[next]}"]`)?.scrollIntoView({ block: 'center' });
    });
  };

  return (
    <div className="dcmp">
      <div className="tcmp__bar">
        <div className="spec-view__modes" role="group" aria-label={t.docPreviewModeAria}>
          {DOC_MODES.map(m => (
            <button key={m} type="button" className={`spec-mode${mode === m ? ' active' : ''}`} aria-pressed={mode === m} title={t.docPreviewModeHints[m]} onClick={() => setMode(m)}>
              {t.docPreviewModeLabels[m]}
            </button>
          ))}
        </div>
        <div className="tcmp__nav">
          <span className="tcmp__count">
            {changed === 0 ? t.comparePreviewDocumentSame : t.comparePreviewChangeOf(Math.max(current + 1, 0), blocks.length)}
          </span>
          <button type="button" className="tcmp__navbtn" onClick={() => go(-1)} disabled={blocks.length === 0} title={t.comparePreviewPrevChange} aria-label={t.comparePreviewPrevChange}>
            <ChevronUpRegular fontSize={14} />
          </button>
          <button type="button" className="tcmp__navbtn" onClick={() => go(1)} disabled={blocks.length === 0} title={t.comparePreviewNextChange} aria-label={t.comparePreviewNextChange}>
            <ChevronDownRegular fontSize={14} />
          </button>
        </div>
      </div>
      <div className="dcmp__head" aria-hidden>
        <span>{sideLabels.older}</span>
        <span>{sideLabels.newer}</span>
      </div>
      <div className="dcmp__body" ref={bodyRef}>
        {items.slice(0, limit).map((item, index) => {
          if (item.kind === 'fold' && !unfolded.has(index)) {
            return (
              <button key={`fold-${index}`} type="button" className="vcmp-formula__fold dcmp__fold" onClick={() => setUnfolded(s => new Set(s).add(index))}>
                {t.compareUnchangedLines(item.rows.length)}
              </button>
            );
          }
          const list = item.kind === 'fold' ? item.rows : [item.row];
          const active = blocks[current] === index;
          return list.map((row, k) => (
            <DocCompareRow key={`${index}-${k}`} row={row} item={k === 0 ? index : undefined} active={active && k === 0} kind={docs.newer!.kind} />
          ));
        })}
        {items.length > limit && (
          <button type="button" className="vcmp-more" onClick={() => setLimit(l => l + DOC_PAGE)}>
            {t.compareShowMore(Math.min(items.length - limit, DOC_PAGE))}
          </button>
        )}
        {(docs.older.truncated || docs.newer.truncated) && <p className="vcmp-empty">{t.docPreviewTruncated(MAX_PREVIEW_LINES)}</p>}
      </div>
    </div>
  );
}

const DocCompareRow = React.memo(function DocCompareRow({ row, item, active, kind }: { row: DocRow; item?: number; active: boolean; kind: 'xml' | 'text' | 'other' }) {
  const split = row.kind === 'changed' && row.older && row.newer ? inlineChange(row.older.text, row.newer.text) : null;
  const cell = (side: Side) => {
    const value = side === 'older' ? row.older : row.newer;
    if (!value) return <span className="dcmp__code dcmp__code--gap" />;
    const tone = row.kind === 'same' ? '' : side === 'older' ? ' dcmp__code--before' : ' dcmp__code--after';
    const mark = split
      ? { from: split.prefix.length, to: split.prefix.length + (side === 'older' ? split.before : split.after).length, className: side === 'older' ? 'vcmp-mark-del' : 'vcmp-mark-ins' }
      : undefined;
    // Long lines wrap under their own indentation, so both sides stay readable and level.
    const hang = kind === 'xml' && !value.line.note ? value.line.indent * 2 : 0;
    return (
      <span
        className={`dcmp__code${tone}${value.line.note ? ' dcmp__code--note' : ''}`}
        style={hang ? { paddingLeft: `calc(8px + ${hang}ch)`, textIndent: `-${hang}ch` } : undefined}
      >
        {value.line.note ? <NoteText line={value.line} /> : <LineSegments line={value.line} kind={kind} mark={mark} />}
      </span>
    );
  };
  return (
    <div className={`dcmp__row dcmp__row--${row.kind}${active ? ' dcmp__row--active' : ''}`} data-item={item}>
      <span className="dcmp__no">{row.older?.number ?? ''}</span>
      {cell('older')}
      <span className="dcmp__no">{row.newer?.number ?? ''}</span>
      {cell('newer')}
    </div>
  );
});

function NoteText({ line }: { line: PreviewLine }) {
  const note = line.note!;
  return (
    <>
      {note.kind === 'repeat' ? <ArrowRepeatAllRegular fontSize={12} aria-hidden />
        : note.kind === 'condition' ? <BranchForkRegular fontSize={12} aria-hidden />
        : <QuestionCircleRegular fontSize={12} aria-hidden />}
      {' '}{note.text}
    </>
  );
}

/** A preview line in its colours, the part that differs from its twin marked. */
function LineSegments({ line, kind, mark }: { line: PreviewLine; kind: 'xml' | 'text' | 'other'; mark?: { from: number; to: number; className: string } }) {
  const pieces: Array<{ text: string; className: string }> = [];
  if (kind === 'xml' && line.indent > 0) pieces.push({ text: '  '.repeat(line.indent), className: '' });
  for (const segment of line.segments) {
    pieces.push({ text: segment.role === 'padding' ? segment.text.replace(/ /g, '·') : segment.text, className: `doc-seg doc-seg--${segment.role}` });
  }
  const out: React.ReactNode[] = [];
  let at = 0;
  pieces.forEach((piece, i) => {
    const start = at;
    const end = at + piece.text.length;
    at = end;
    if (!mark || mark.to <= start || mark.from >= end || mark.to <= mark.from) {
      out.push(<span key={i} className={piece.className}>{piece.text}</span>);
      return;
    }
    const a = Math.max(mark.from, start) - start;
    const b = Math.min(mark.to, end) - start;
    out.push(
      <span key={i} className={piece.className}>
        {piece.text.slice(0, a)}
        <span className={mark.className}>{piece.text.slice(a, b)}</span>
        {piece.text.slice(b)}
      </span>,
    );
  });
  return <>{out}</>;
}
