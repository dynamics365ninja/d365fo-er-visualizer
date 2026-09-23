import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { t, useLocale } from '../../i18n';
import { ERDirection, type ERFormatElement, type ERLabel } from '@er-visualizer/core';
import { resolveLabel, buildLabelPool, labelLanguageTag } from '../../utils/label-resolver';
import { useTabState } from '../../utils/tab-view-state';
import { parseXlsxBase64, colToLetter, type XlsxWorkbook, type XlsxCell as XlsxCellType, type XlsxMerge, type XlsxArea, type XlsxDrawing, type XlsxAnchorPoint } from '../../utils/xlsx-parser';
import { type BindingMap, type PreviewRenderOptions, isSamplePlaceholder, previewValue } from './preview-values';

interface ExcelSheetData {
  name: string;
  header: ExcelSectionData | null;
  footer: ExcelSectionData | null;
  ranges: ExcelRangeData[];
  cells: ExcelCellData[];
}

interface ExcelSectionData {
  name: string;
  type: 'header' | 'footer';
  cells: ExcelCellData[];
}

interface ExcelRangeData {
  name: string;
  excelRange: string;
  replicationDirection: string;
  cells: ExcelCellData[];
  children: ExcelRangeData[];
}

interface ExcelCellData {
  name: string;
  excelRange: string;
  value: string;
  /** Resolved label text (from ERLabel) if the cell has a Label attribute */
  label?: string;
}

function collectExcelSheets(root: ERFormatElement, bm: BindingMap, labels?: ERLabel[], options: PreviewRenderOptions = { placeholderMode: 'sample' }, labelLang?: string): ExcelSheetData[] {
  const sheets: ExcelSheetData[] = [];

  const resolveCellLabel = (el: ERFormatElement): string | undefined => {
    const labelRef = el.attributes?.['Label'];
    if (!labelRef) return undefined;
    const resolved = resolveLabel(labelRef, labels, labelLang);
    return resolved?.localized ?? resolved?.enUs ?? undefined;
  };

  const collectCells = (el: ERFormatElement): ExcelCellData[] => {
    if (el.elementType === 'ExcelCell') {
      return [{
        name: el.name,
        excelRange: el.attributes?.['ExcelRange'] ?? el.name,
        value: previewValue(el, bm, options),
        label: resolveCellLabel(el),
      }];
    }
    return el.children.flatMap(c => collectCells(c));
  };

  const collectRanges = (el: ERFormatElement): ExcelRangeData[] => {
    if (el.elementType === 'ExcelRange') {
      return [{
        name: el.name,
        excelRange: el.attributes?.['ExcelRange'] ?? el.name,
        replicationDirection: el.attributes?.['ReplicationDirection'] === '1' ? 'vertical' : el.attributes?.['ReplicationDirection'] === '2' ? 'horizontal' : '',
        cells: el.children.filter(c => c.elementType === 'ExcelCell').map(c => ({
          name: c.name,
          excelRange: c.attributes?.['ExcelRange'] ?? c.name,
          value: previewValue(c, bm, options),
          label: resolveCellLabel(c),
        })),
        children: el.children.filter(c => c.elementType === 'ExcelRange').flatMap(c => collectRanges(c)),
      }];
    }
    return el.children.flatMap(c => collectRanges(c));
  };

  const walkSheet = (el: ERFormatElement) => {
    if (el.elementType === 'ExcelSheet') {
      const header = el.children.find(c => c.elementType === 'ExcelHeader');
      const footer = el.children.find(c => c.elementType === 'ExcelFooter');
      const bodyChildren = el.children.filter(c => c.elementType !== 'ExcelHeader' && c.elementType !== 'ExcelFooter');
      sheets.push({
        name: el.name,
        header: header ? { name: header.name, type: 'header', cells: collectCells(header) } : null,
        footer: footer ? { name: footer.name, type: 'footer', cells: collectCells(footer) } : null,
        ranges: bodyChildren.flatMap(c => collectRanges(c)),
        cells: bodyChildren.filter(c => c.elementType === 'ExcelCell').map(c => ({
          name: c.name,
          excelRange: c.attributes?.['ExcelRange'] ?? c.name,
          value: previewValue(c, bm, options),
          label: resolveCellLabel(c),
        })),
      });
    } else {
      for (const child of el.children) walkSheet(child);
    }
  };
  walkSheet(root);

  // Many Excel formats have no ExcelSheet wrapper — cells/ranges sit directly under ExcelFile.
  // Treat the root as an implicit single sheet in that case.
  if (sheets.length === 0 && (root.elementType === 'ExcelFile' || root.elementType === 'ExcelSheet')) {
    const header = root.children.find(c => c.elementType === 'ExcelHeader');
    const footer = root.children.find(c => c.elementType === 'ExcelFooter');
    const bodyChildren = root.children.filter(c => c.elementType !== 'ExcelHeader' && c.elementType !== 'ExcelFooter');
    sheets.push({
      name: root.name || 'Sheet1',
      header: header ? { name: header.name, type: 'header', cells: collectCells(header) } : null,
      footer: footer ? { name: footer.name, type: 'footer', cells: collectCells(footer) } : null,
      ranges: bodyChildren.flatMap(c => collectRanges(c)),
      cells: bodyChildren.filter(c => c.elementType === 'ExcelCell').map(c => ({
        name: c.name,
        excelRange: c.attributes?.['ExcelRange'] ?? c.name,
        value: previewValue(c, bm, options),
        label: resolveCellLabel(c),
      })),
    });
  }

  return sheets;
}

/**
 * Both Excel previews reproduce a spreadsheet whose cell colours come from the
 * workbook itself and are authored for white paper. Rendering them on a dark
 * theme surface put dark text on a dark background, so the sheet area keeps a
 * fixed light palette in both themes — like a print preview. Only the
 * surrounding chrome (toolbar, legend, sheet tabs) follows the theme.
 */
const excelPaper = {
  cellBg: '#ffffff',
  cellText: '#1a1a1a',
  mutedText: '#5f6368',
  headerBg: '#f3f3f3',
  headerText: '#5f6368',
  cellBorder: '#d4d4d4',
  gridBg: '#e9e9e9',
  sectionBg: '#f7f7f7',
  rangeBg: '#eef4f0',
  dynamicText: '#8a3fa0',
};

/** Theme-aware chrome around the paper: ribbon, sheet tabs, range accents. */
const excelColors = {
  sheetTab: '#217346',
  sheetTabText: '#fff',
  cellBorder: 'var(--border-subtle)',
  // The Excel green is kept for borders and accents only — green text on a
  // green tint was unreadable in both themes.
  rangeBorder: '#217346',
  cellBg: 'var(--bg-primary)',
};

// ── Build cell-address → binding map from format tree ──
function buildCellBindingMap(root: ERFormatElement, bm: BindingMap, labels?: ERLabel[], options: PreviewRenderOptions = { placeholderMode: 'sample' }, labelLang?: string): Map<string, { value: string; name: string; label?: string; elementId: string }> {
  const map = new Map<string, { value: string; name: string; label?: string; elementId: string }>();
  const walk = (el: ERFormatElement) => {
    if (el.elementType === 'ExcelCell') {
      const addr = el.attributes?.['ExcelRange'] ?? el.name;
      const labelRef = el.attributes?.['Label'];
      let label: string | undefined;
      if (labelRef && labels) {
        const resolved = resolveLabel(labelRef, labels, labelLang);
        label = resolved?.enUs ?? resolved?.localized ?? undefined;
      }
      map.set(addr.toUpperCase(), { value: previewValue(el, bm, options), name: el.name, label, elementId: el.id });
    }
    for (const child of el.children) walk(child);
  };
  walk(root);
  return map;
}

// ── Excel Template Grid (renders parsed .xlsx with binding overlays) ──

/** English Metric Units per CSS pixel (Office uses 914400 EMU per inch at 96 dpi). */
const EMU_PER_PX = 9525;
/** Height of the sticky column-letter header row, in px. */
const EXCEL_HEADER_H = 20;
/** Width of the sticky row-number gutter, in px. */
const EXCEL_GUTTER_W = 32;
/** Row height used when the sheet does not store an explicit one. */
const EXCEL_DEFAULT_ROW_H = 20;

/** Marks an Excel preview that is only an intermediate step — F&O converts it to PDF. */
function PdfOutputBadge() {
  return (
    <span
      title={t.pdfConvertedFrom('Excel')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px',
        borderRadius: 3,
        border: '1px solid rgba(255,255,255,0.4)',
        background: 'rgba(255,255,255,0.15)',
        color: excelColors.sheetTabText,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      📕 PDF
    </span>
  );
}

function ExcelTemplateGrid({
  workbook,
  filename,
  bindingMap,
  rootElement,
  labels,
  pdfOutput,
  onSwitchToStructure,
  onElementClick,
}: {
  workbook: XlsxWorkbook;
  filename: string;
  bindingMap: BindingMap;
  rootElement: ERFormatElement;
  labels?: ERLabel[];
  pdfOutput?: boolean;
  onSwitchToStructure: () => void;
  onElementClick?: (elementId: string) => void;
}) {
  const [activeSheet, setActiveSheet] = useState(0);
  /** Cell the pointer is over — drives the highlight of the cell and its named area. */
  const [hoveredRef, setHoveredRef] = useState<string | null>(null);
  const previewOptions = useMemo<PreviewRenderOptions>(() => ({ placeholderMode: 'sample' }), []);
  // Cell labels are resolved in the app's language, so a switch re-resolves them.
  const labelLang = labelLanguageTag(useLocale());
  const cellBindings = useMemo(() => buildCellBindingMap(rootElement, bindingMap, labels, previewOptions, labelLang), [rootElement, bindingMap, labels, previewOptions, labelLang]);

  const sheetName = workbook.sheets[Math.min(activeSheet, workbook.sheets.length - 1)]?.name;

  /**
   * The named ranges whose cells sit on the sheet on screen. A name is often
   * defined once per sheet (`localSheetId`), and each definition only applies
   * to its own sheet — a name with no sheet at all applies everywhere.
   */
  const sheetNamedAreas = useMemo(() => {
    const current = sheetName?.toUpperCase();
    return (workbook.namedAreas ?? []).filter(n => !n.sheet || n.sheet.toUpperCase() === current);
  }, [workbook.namedAreas, sheetName]);

  // Reverse map: cell ref (e.g. "B3") → named range (e.g. "CONTACTINFO_LABEL")
  // Needed because ExcelRange attribute stores named range names, not cell addresses.
  const cellRefToNamedRange = useMemo(() => {
    const map = new Map<string, string>();
    for (const { name, anchor } of sheetNamedAreas) {
      // name is already uppercased in parser; the first definition wins.
      if (!map.has(anchor)) map.set(anchor, name);
    }
    return map;
  }, [sheetNamedAreas]);

  /**
   * Every cell covered by a named range, mapped to that range. A named range
   * can span several cells, so hovering any of them highlights the whole area
   * rather than the single cell under the pointer.
   */
  const cellRefToArea = useMemo(() => {
    const map = new Map<string, { name: string; area: XlsxArea }>();
    for (const { name, area } of sheetNamedAreas) {
      const width = area.endCol - area.startCol + 1;
      const height = area.endRow - area.startRow + 1;
      // A runaway whole-column range would paint the entire sheet.
      if (width * height > 2000) continue;
      for (let row = area.startRow; row <= area.endRow; row++) {
        for (let col = area.startCol; col <= area.endCol; col++) {
          const ref = colToLetter(col) + row;
          if (!map.has(ref)) map.set(ref, { name, area });
        }
      }
    }
    return map;
  }, [sheetNamedAreas]);

  const sheet = workbook.sheets[Math.min(activeSheet, workbook.sheets.length - 1)];
  if (!sheet) return null;

  // Build grid bounds
  let maxCol = 0;
  let maxRow = 0;
  for (const row of sheet.rows) {
    if (row.index > maxRow) maxRow = row.index;
    for (const cell of row.cells) {
      if (cell.col > maxCol) maxCol = cell.col;
    }
  }
  for (const merge of sheet.merges) {
    if (merge.endCol > maxCol) maxCol = merge.endCol;
    if (merge.endRow > maxRow) maxRow = merge.endRow;
  }
  // A logo or a floating title may sit past the last filled cell (F&O anchors
  // the report header in the drawing layer), so the grid has to reach it or the
  // overlay would be clipped away.
  for (const drawing of [...sheet.images, ...sheet.textShapes]) {
    const endCol = (drawing.to?.col ?? drawing.from.col) + 1;
    const endRow = (drawing.to?.row ?? drawing.from.row) + 1;
    if (endCol > maxCol) maxCol = endCol;
    if (endRow > maxRow) maxRow = endRow;
  }
  // Limit to reasonable viewport
  maxCol = Math.min(maxCol, 30);
  maxRow = Math.min(maxRow, 200);

  // Build cell lookup: "A1" → cell
  const cellMap = new Map<string, XlsxCellType>();
  for (const row of sheet.rows) {
    for (const cell of row.cells) {
      cellMap.set(cell.ref, cell);
    }
  }

  // Build merge lookup: "A1" → merge (for top-left cell)
  const mergeMap = new Map<string, XlsxMerge>();
  const mergedCells = new Set<string>(); // cells that are part of a merge but not the anchor
  for (const m of sheet.merges) {
    const anchorRef = colToLetter(m.startCol) + m.startRow;
    mergeMap.set(anchorRef, m);
    for (let r = m.startRow; r <= m.endRow; r++) {
      for (let c = m.startCol; c <= m.endCol; c++) {
        const ref = colToLetter(c) + r;
        if (ref !== anchorRef) mergedCells.add(ref);
      }
    }
  }

  // Column widths in pixels (approx 8px per character width unit)
  const colWidth = (col: number) => {
    const w = sheet.colWidths.get(col);
    return w ? Math.max(30, Math.round(w * 8)) : 64;
  };

  // Row heights in pixels. The drawing layer is positioned against the same
  // geometry, so an approximated row height would push the logo off its band.
  const rowHeights = new Map<number, number>();
  for (const row of sheet.rows) {
    if (row.height != null && row.height > 0) {
      rowHeights.set(row.index, Math.max(6, Math.round(row.height * (96 / 72))));
    }
  }
  const rowHeight = (row: number) => rowHeights.get(row) ?? EXCEL_DEFAULT_ROW_H;

  /** Left edge of a 1-based column, relative to the top-left of the table. */
  const colX = (col: number) => {
    let x = EXCEL_GUTTER_W;
    for (let c = 1; c < col; c++) x += colWidth(c);
    return x;
  };
  /** Top edge of a 1-based row, relative to the top-left of the table. */
  const rowY = (row: number) => {
    let y = EXCEL_HEADER_H;
    for (let r = 1; r < row; r++) y += rowHeight(r);
    return y;
  };
  /** Anchor (0-based col/row + EMU offsets) → pixel position on the grid. */
  const anchorToPx = (a: XlsxAnchorPoint) => ({
    x: colX(a.col + 1) + a.colOff / EMU_PER_PX,
    y: rowY(a.row + 1) + a.rowOff / EMU_PER_PX,
  });
  const drawingBox = (d: XlsxDrawing) => {
    const start = anchorToPx(d.from);
    if (d.to) {
      const end = anchorToPx(d.to);
      return { left: start.x, top: start.y, width: Math.max(1, end.x - start.x), height: Math.max(1, end.y - start.y) };
    }
    return {
      left: start.x,
      top: start.y,
      width: Math.max(1, (d.ext?.cx ?? 0) / EMU_PER_PX),
      height: Math.max(1, (d.ext?.cy ?? 0) / EMU_PER_PX),
    };
  };

  const gridWidth = colX(maxCol + 1);
  const gridHeight = rowY(maxRow + 1);
  const drawings = [...sheet.images, ...sheet.textShapes];

  const totalCells = sheet.rows.reduce((s, r) => s + r.cells.length, 0);

  // Hover highlight: a named area wins over the single cell, because that is
  // the unit an ER binding actually writes into.
  const hovered = hoveredRef ? cellRefToArea.get(hoveredRef) : undefined;
  const hoveredCell = hoveredRef ? refToCoords(hoveredRef) : null;
  const highlightArea: XlsxArea | null = hovered
    ? hovered.area
    : hoveredCell
      ? { startCol: hoveredCell.col, startRow: hoveredCell.row, endCol: hoveredCell.col, endRow: hoveredCell.row }
      : null;
  /** True when the cell (or the merge it anchors) overlaps the highlighted area. */
  const isHighlighted = (col: number, row: number, colSpan: number, rowSpan: number): boolean => (
    !!highlightArea
    && col <= highlightArea.endCol && col + colSpan - 1 >= highlightArea.startCol
    && row <= highlightArea.endRow && row + rowSpan - 1 >= highlightArea.startRow
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: excelColors.sheetTab,
        color: excelColors.sheetTabText,
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14 }}>📄</span>
        <span>{t.excelTemplateView}: {filename}</span>
        {pdfOutput && <PdfOutputBadge />}
        <button
          onClick={onSwitchToStructure}
          style={{
            marginLeft: 8,
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.15)',
            color: excelColors.sheetTabText,
          }}
          title={t.excelStructureView}
        >
          📊 {t.excelStructureView}
        </button>
        <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, opacity: 0.8 }}>
          {hoveredRef
            ? `${hovered ? `${hovered.name} · ${colToLetter(hovered.area.startCol)}${hovered.area.startRow}:${colToLetter(hovered.area.endCol)}${hovered.area.endRow}` : hoveredRef}`
            : `${t.excelTemplateCells(totalCells)}${sheet.merges.length > 0 ? `, ${t.excelTemplateMerged(sheet.merges.length)}` : ''}${sheet.images.length > 0 ? `, ${t.excelTemplateImages(sheet.images.length)}` : ''}`}
        </span>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'auto', background: excelPaper.gridBg }} onMouseLeave={() => setHoveredRef(null)}>
        <div style={{ position: 'relative', width: gridWidth, minHeight: gridHeight }}>
        <table style={{
          borderCollapse: 'collapse',
          fontSize: 11,
          fontFamily: 'Calibri, "Segoe UI", sans-serif',
          tableLayout: 'fixed',
        }}>
          {/* Column headers */}
          <thead>
            <tr style={{ height: EXCEL_HEADER_H }}>
              <th style={{
                width: EXCEL_GUTTER_W,
                minWidth: EXCEL_GUTTER_W,
                background: excelPaper.headerBg,
                borderRight: `1px solid ${excelPaper.cellBorder}`,
                borderBottom: `1px solid ${excelPaper.cellBorder}`,
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 3,
              }} />
              {Array.from({ length: maxCol }, (_, i) => i + 1).map(col => (
                <th key={col} style={{
                  width: colWidth(col),
                  minWidth: colWidth(col),
                  padding: '2px 4px',
                  background: highlightArea && col >= highlightArea.startCol && col <= highlightArea.endCol
                    ? 'color-mix(in srgb, var(--accent) 30%, ' + excelPaper.headerBg + ')'
                    : excelPaper.headerBg,
                  color: excelPaper.headerText,
                  fontWeight: 500,
                  fontSize: 10,
                  textAlign: 'center',
                  borderRight: `1px solid ${excelPaper.cellBorder}`,
                  borderBottom: `1px solid ${excelPaper.cellBorder}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                }}>
                  {colToLetter(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRow }, (_, i) => i + 1).map(row => (
              <tr key={row} style={{ height: rowHeight(row) }}>
                {/* Row header */}
                <td style={{
                  padding: '1px 4px',
                  background: highlightArea && row >= highlightArea.startRow && row <= highlightArea.endRow
                    ? 'color-mix(in srgb, var(--accent) 30%, ' + excelPaper.headerBg + ')'
                    : excelPaper.headerBg,
                  color: excelPaper.headerText,
                  fontWeight: 500,
                  fontSize: 10,
                  textAlign: 'center',
                  borderRight: `1px solid ${excelPaper.cellBorder}`,
                  borderBottom: `1px solid ${excelPaper.cellBorder}`,
                  position: 'sticky',
                  left: 0,
                  zIndex: 1,
                }}>
                  {row}
                </td>
                {Array.from({ length: maxCol }, (_, i) => i + 1).map(col => {
                  const ref = colToLetter(col) + row;
                  // Skip cells that are part of a merge (not the anchor)
                  if (mergedCells.has(ref)) return null;

                  const merge = mergeMap.get(ref);
                  const colSpan = merge ? (merge.endCol - merge.startCol + 1) : 1;
                  const rowSpan = merge ? (merge.endRow - merge.startRow + 1) : 1;

                  const xlsxCell = cellMap.get(ref);
                  // Look up binding: first try direct cell ref, then via named range
                  const namedRange = cellRefToNamedRange.get(ref.toUpperCase());
                  const binding = cellBindings.get(ref.toUpperCase()) ?? (namedRange ? cellBindings.get(namedRange) : undefined);
                  const hasBinding = !!binding;
                  const hasValue = xlsxCell && xlsxCell.value !== '';
                  const cellStyle = xlsxCell?.style;

                  // Determine display value — always prefer the original Excel cell text
                  let displayValue = '';
                  if (hasValue) {
                    displayValue = xlsxCell.value;
                  } else if (hasBinding) {
                    displayValue = binding.value;
                  }

                  // Resolve fill color from Excel style (solid fills only).
                  const xlsxBg = cellStyle?.fillType === 'solid' && cellStyle.fgColor
                    ? `#${cellStyle.fgColor.slice(-6)}`
                    : undefined;
                  const borderStyle = () => `1px solid ${excelPaper.cellBorder}`;
                  const highlighted = isHighlighted(col, row, colSpan, rowSpan);

                  return (
                    <td
                      key={col}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      title={hasBinding
                        ? `${binding.name}${binding.label ? ` — ${binding.label}` : ''}\n${binding.value}${onElementClick ? `\n🔍 ${t.excelCellGoToStructure}` : ''}`
                        : xlsxCell?.value || undefined}
                      onClick={hasBinding && onElementClick ? () => onElementClick(binding.elementId) : undefined}
                      onMouseEnter={() => setHoveredRef(ref)}
                      style={{
                        padding: '1px 3px',
                        borderRight: borderStyle(),
                        borderBottom: borderStyle(),
                        borderTop: cellStyle?.borderTop && cellStyle.borderTop !== 'none' ? `1px solid ${excelPaper.cellBorder}` : undefined,
                        borderLeft: cellStyle?.borderLeft && cellStyle.borderLeft !== 'none' ? `1px solid ${excelPaper.cellBorder}` : undefined,
                        background: xlsxBg ?? excelPaper.cellBg,
                        color: cellStyle?.fontColor
                              ? `#${cellStyle.fontColor.slice(-6)}`
                              : excelPaper.cellText,
                        fontStyle: cellStyle?.italic ? 'italic' : undefined,
                        fontWeight: cellStyle?.bold ? 700 : undefined,
                        textDecoration: cellStyle?.underline ? 'underline' : undefined,
                        fontSize: cellStyle?.fontSize ? `${cellStyle.fontSize}pt` : undefined,
                        whiteSpace: cellStyle?.wrapText ? 'normal' : 'nowrap',
                        textAlign: cellStyle?.hAlign === 'center' ? 'center' : cellStyle?.hAlign === 'right' ? 'right' : undefined,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: merge ? undefined : colWidth(col),
                        height: rowHeight(row),
                        cursor: hasBinding && onElementClick ? 'pointer' : undefined,
                        // The whole named area lights up together, so it is obvious
                        // how far the range under the pointer reaches.
                        boxShadow: highlighted
                          ? 'inset 0 0 0 1px var(--accent), inset 0 0 0 999px color-mix(in srgb, var(--accent) 16%, transparent)'
                          : undefined,
                      }}
                    >
                      {displayValue}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Drawing layer — logos and floating text boxes sit above the cells.
            F&O report templates keep the company logo and the report title
            here, so without this overlay the header band renders empty. */}
        {drawings.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {sheet.images.map(img => {
              const box = drawingBox(img);
              return (
                <img
                  key={`img-${img.id}`}
                  src={img.dataUrl}
                  alt={img.name || t.excelTemplateImage}
                  title={img.name || t.excelTemplateImage}
                  style={{
                    position: 'absolute',
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    objectFit: 'fill',
                  }}
                />
              );
            })}
            {sheet.textShapes.map(shape => {
              const box = drawingBox(shape);
              return (
                <div
                  key={`txt-${shape.id}`}
                  title={shape.name || undefined}
                  style={{
                    position: 'absolute',
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: shape.align === 'ctr' ? 'center' : shape.align === 'r' ? 'flex-end' : 'flex-start',
                    fontSize: shape.fontSize ? `${shape.fontSize}pt` : undefined,
                    fontWeight: shape.bold ? 700 : undefined,
                    color: shape.color ? `#${shape.color}` : excelPaper.cellText,
                    lineHeight: 1.1,
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {shape.text}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* Legend */}
      <div style={{
        padding: '4px 12px',
        fontSize: 10,
        color: 'var(--text-secondary)',
        borderTop: `1px solid ${excelColors.cellBorder}`,
        background: 'var(--bg-secondary)',
        display: 'flex',
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>📄 {t.excelTemplateView} · 📊 {t.excelStructureView}</span>
      </div>

      {/* Sheet tabs */}
      {workbook.sheets.length > 1 && (
        <div style={{
          display: 'flex',
          gap: 0,
          borderTop: `2px solid ${excelColors.sheetTab}`,
          background: 'var(--bg-secondary)',
          padding: '0 8px',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          {workbook.sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: i === activeSheet ? 700 : 400,
                cursor: 'pointer',
                border: 'none',
                borderTop: i === activeSheet ? `2px solid ${excelColors.sheetTab}` : '2px solid transparent',
                background: i === activeSheet ? excelColors.cellBg : 'transparent',
                color: i === activeSheet ? excelColors.sheetTab : 'var(--text-secondary)',
                marginTop: -2,
                transition: 'all 0.15s',
              }}
            >
              📃 {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Convert a cell reference such as "AB12" to 1-based coordinates. */
function refToCoords(ref: string): { col: number; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: parseInt(match[2], 10) };
}

/** Collect all unique cell addresses from a sheet to derive column letters for the header. */
function collectSheetColumns(sheet: ExcelSheetData): string[] {
  const cols = new Set<string>();
  const extractCol = (addr: string) => {
    const m = addr.match(/^([A-Z]+)\d/);
    if (m) cols.add(m[1]);
  };
  for (const c of sheet.cells) extractCol(c.excelRange);
  const walkRange = (r: ExcelRangeData) => {
    for (const c of r.cells) extractCol(c.excelRange);
    for (const child of r.children) walkRange(child);
  };
  for (const r of sheet.ranges) walkRange(r);
  if (sheet.header) for (const c of sheet.header.cells) extractCol(c.excelRange);
  if (sheet.footer) for (const c of sheet.footer.cells) extractCol(c.excelRange);
  // Sort alphabetically (A, B, C, ..., AA, AB, ...)
  return Array.from(cols).sort((a, b) => a.length - b.length || a.localeCompare(b));
}

export function ExcelVisualPreview({ rootElement, direction, bindingMap, configIndex, template, onNavigateToElement, pdfOutput, tabId }: { rootElement: ERFormatElement; direction: ERDirection | undefined; bindingMap: BindingMap; configIndex: number; template?: { filename: string; base64?: string }; onNavigateToElement?: (elementId: string) => void; pdfOutput?: boolean; tabId?: string }) {
  const configurations = useAppStore(s => s.configurations);
  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);
  const previewOptions = useMemo<PreviewRenderOptions>(() => ({ placeholderMode: 'sample' }), []);
  // Cell labels are resolved in the app's language, so a switch re-resolves them.
  const labelLang = labelLanguageTag(useLocale());
  const sheets = useMemo(() => collectExcelSheets(rootElement, bindingMap, labels, previewOptions, labelLang), [rootElement, bindingMap, labels, previewOptions, labelLang]);
  const [activeSheet, setActiveSheet] = useTabState(tabId, 'excel.sheet', 0);
  const [selectedCell, setSelectedCell] = useState<ExcelCellData | null>(null);
  // A workbook the user loaded belongs to the format it was loaded for, and is
  // kept with the tab: leaving the preview (for Structure, say) unmounts this
  // component, and coming back used to ask for the same file again.
  const templateKey = `${configIndex}\u0000${template?.filename ?? ''}`;
  const [droppedTemplate, setDroppedTemplate] = useTabState<{ key: string; base64: string } | null>(tabId, 'excel.droppedTemplate', null);
  const droppedBase64 = droppedTemplate?.key === templateKey ? droppedTemplate.base64 : null;
  const effectiveBase64 = droppedBase64 ?? template?.base64 ?? null;
  // Opening the preview starts on the template whenever there is one (even
  // filename-only — that shows the drop zone). Deliberately not remembered per
  // tab: a trip to Structure from inside the template must not make the next
  // visit to Preview open on the structure.
  const [viewMode, setViewMode] = useState<'structure' | 'template'>(
    () => (template || effectiveBase64 ? 'template' : 'structure'),
  );
  const [xlsxData, setXlsxData] = useState<XlsxWorkbook | null>(null);
  const [xlsxError, setXlsxError] = useState<string | null>(null);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragInvalid, setDragInvalid] = useState(false);

  const loadTemplate = useCallback((base64: string) => {
    setDroppedTemplate({ key: templateKey, base64 });
    setXlsxData(null);
    setXlsxError(null);
    setViewMode('template');
  }, [setDroppedTemplate, templateKey]);

  // Parse xlsx whenever effectiveBase64 becomes available.
  // The parsed workbook is cached against the base64 it came from: without
  // that key the guard below (`xlsxData` already set) would keep showing the
  // template of the format that was open first when several Excel formats are
  // loaded and the user switches tabs.
  const parsedForRef = useRef<string | null>(null);
  // Leaving the preview while the workbook is still parsing must not set
  // state on an unmounted component (the effect itself re-runs on every
  // state change, so a per-run flag would cancel the in-flight parse).
  // StrictMode mounts, unmounts and remounts in dev, so the flag has to be
  // raised again on remount — otherwise the parse result is dropped and the
  // preview stays on "loading" forever.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!effectiveBase64) {
      parsedForRef.current = null;
      if (xlsxData) setXlsxData(null);
      if (xlsxError) setXlsxError(null);
      return;
    }
    if (parsedForRef.current === effectiveBase64) return;
    parsedForRef.current = effectiveBase64;
    setXlsxData(null);
    setXlsxError(null);
    setXlsxLoading(true);
    parseXlsxBase64(effectiveBase64)
      .then(wb => {
        if (!mountedRef.current || parsedForRef.current !== effectiveBase64) return;
        setXlsxData(wb); setXlsxLoading(false);
      })
      .catch(err => {
        if (!mountedRef.current || parsedForRef.current !== effectiveBase64) return;
        setXlsxError(String(err)); setXlsxLoading(false);
      });
  }, [effectiveBase64, xlsxData, xlsxError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDragInvalid(false);
    const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.xlsx'));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      // data:...;base64,XXXXX → take the part after the comma
      const b64 = dataUrl.split(',')[1];
      if (b64) loadTemplate(b64);
    };
    reader.readAsDataURL(file);
  }, [loadTemplate]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const hasXlsx = Array.from(e.dataTransfer.items).some(
      item => item.kind === 'file' && (item.type.includes('spreadsheet') || item.type === '' /* filename-only drag */),
    );
    setIsDragOver(true);
    setDragInvalid(!hasXlsx && e.dataTransfer.items.length > 0);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only fire when leaving the outermost element
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement | null)) {
      setIsDragOver(false);
      setDragInvalid(false);
    }
  }, []);

  if (sheets.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>{t.excelNoSheets}</div>;
  }

  // If template mode is active and data is ready, render template view
  if (viewMode === 'template') {
    if (xlsxLoading) {
      return <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 12 }}>{t.excelTemplateLoading}</div>;
    }
    if (xlsxError) {
      return (
        <div
          style={{ padding: 24, color: 'var(--error)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
          onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
        >
          <div>{t.excelTemplateError}: {xlsxError}</div>
          <div style={{ color: 'var(--text-secondary)' }}>{t.excelTemplateDropHint}</div>
        </div>
      );
    }
    if (xlsxData) {
      return (
        <ExcelTemplateGrid
          workbook={xlsxData}
          filename={template?.filename ?? ''}
          bindingMap={bindingMap}
          rootElement={rootElement}
          labels={labels}
          pdfOutput={pdfOutput}
          onSwitchToStructure={() => setViewMode('structure')}
          onElementClick={onNavigateToElement ? (elementId) => {
            setViewMode('structure');
            onNavigateToElement(elementId);
          } : undefined}
        />
      );
    }
    // No binary yet — show drop zone
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 16,
          background: isDragOver
            ? (dragInvalid ? 'rgba(var(--error-rgb,220,38,38),0.08)' : 'rgba(var(--accent-rgb,3,131,135),0.08)')
            : 'var(--bg-secondary)',
          border: `2px dashed ${isDragOver ? (dragInvalid ? 'var(--error,#dc2626)' : 'var(--focus-border,#038387)') : 'var(--border-color,#444)'}`,
          borderRadius: 8,
          margin: 16,
          transition: 'background 0.15s, border-color 0.15s',
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 40 }}>{isDragOver ? (dragInvalid ? '🚫' : '📂') : '📄'}</span>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
          {isDragOver
            ? (dragInvalid ? t.excelTemplateDropInvalid : t.excelTemplateDropActive)
            : t.excelTemplateLoadBtn}
        </div>
        {template?.filename && !isDragOver && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono,monospace)' }}>
            {template.filename}
          </div>
        )}
        {!isDragOver && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 320 }}>
            {t.excelTemplateDropHint}
          </div>
        )}
        <label style={{
          marginTop: 4,
          padding: '6px 14px',
          fontSize: 12,
          border: '1px solid var(--border-color,#444)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          background: 'var(--bg-primary)',
        }}>
          {t.excelTemplateLoadBtn}
          <input
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const b64 = (ev.target?.result as string)?.split(',')[1];
                if (b64) loadTemplate(b64);
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => setViewMode('structure')}
          style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {t.excelStructureView}
        </button>
      </div>
    );
  }

  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)];
  const columns = collectSheetColumns(sheet);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-secondary)' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay (structure view) */}
      {isDragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: dragInvalid ? 'rgba(220,38,38,0.12)' : 'rgba(3,131,135,0.12)',
          border: `3px dashed ${dragInvalid ? '#dc2626' : '#038387'}`,
          pointerEvents: 'none',
          borderRadius: 4,
        }}>
          <span style={{ fontSize: 14, background: 'var(--bg-primary)', padding: '8px 16px', borderRadius: 6, fontWeight: 600, color: dragInvalid ? '#dc2626' : '#038387' }}>
            {dragInvalid ? t.excelTemplateDropInvalid : t.excelTemplateDropActive}
          </span>
        </div>
      )}
      {/* Ribbon-like toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: excelColors.sheetTab,
        color: excelColors.sheetTabText,
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14 }}>📊</span>
        <span>{direction === ERDirection.Import ? t.excelInput : t.excelOutput} {t.excelWorkbook}</span>
        {pdfOutput && <PdfOutputBadge />}
        {(template || effectiveBase64) && (
          <div style={{ display: 'flex', marginLeft: 8, border: '1px solid rgba(255,255,255,0.4)', borderRadius: 3, overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('structure')}
              style={{
                padding: '2px 10px',
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                background: 'rgba(255,255,255,0.3)',
                color: excelColors.sheetTabText,
                fontWeight: 700,
              }}
            >
              📊 {t.excelStructureView}
            </button>
            <button
              onClick={() => setViewMode('template')}
              style={{
                padding: '2px 10px',
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                borderLeft: '1px solid rgba(255,255,255,0.3)',
                background: 'transparent',
                color: excelColors.sheetTabText,
                fontWeight: 400,
              }}
            >
              📄 {effectiveBase64 ? t.excelTemplateView : t.excelTemplateLoadBtn}
            </button>
          </div>
        )}
        <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, opacity: 0.8 }}>
          {sheet ? `${t.excelRangeCount(sheet.ranges.length)}, ${t.excelCellCount(sheet.cells.length + sheet.ranges.reduce((sum, r) => sum + r.cells.length, 0))}` : ''}
        </span>
      </div>

      {/* Name Box + Formula Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: `1px solid ${excelPaper.cellBorder}`,
        background: excelPaper.cellBg,
        flexShrink: 0,
      }}>
        <div style={{
          width: 120,
          padding: '4px 8px',
          fontSize: 11,
          fontWeight: 600,
          borderRight: `1px solid ${excelPaper.cellBorder}`,
          fontFamily: 'var(--font-mono, monospace)',
          color: excelPaper.cellText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {selectedCell?.excelRange ?? ''}
        </div>
        <div style={{
          padding: '4px 6px',
          fontSize: 11,
          color: excelPaper.mutedText,
          borderRight: `1px solid ${excelPaper.cellBorder}`,
          fontStyle: 'italic',
        }}>
          <i>fx</i>
        </div>
        <div style={{
          flex: 1,
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'var(--font-mono, monospace)',
          color: excelPaper.cellText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {selectedCell ? (() => {
            const parts: string[] = [];
            if (selectedCell.name !== selectedCell.excelRange) parts.push(selectedCell.name);
            if (selectedCell.label) parts.push(selectedCell.label);
            parts.push(selectedCell.value);
            return parts.join(': ');
          })() : ''}
        </div>
      </div>

      {/* Column headers */}
      {columns.length > 0 && (
        <div style={{
          display: 'flex',
          borderBottom: `1px solid ${excelPaper.cellBorder}`,
          background: excelPaper.headerBg,
          flexShrink: 0,
          paddingLeft: 32,
        }}>
          {columns.map(col => (
            <div key={col} style={{
              minWidth: 80,
              flex: 1,
              maxWidth: 220,
              padding: '2px 8px',
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 600,
              color: excelPaper.headerText,
              borderRight: `1px solid ${excelPaper.cellBorder}`,
              userSelect: 'none',
            }}>
              {col}
            </div>
          ))}
        </div>
      )}

      {/* Spreadsheet area */}
      <div style={{ flex: 1, overflow: 'auto', padding: 0, background: excelPaper.gridBg }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${excelPaper.cellBorder}`,
          overflow: 'hidden',
          background: excelPaper.cellBg,
          minHeight: '100%',
        }}>
          {/* Header section */}
          {sheet.header && sheet.header.cells.length > 0 && (
            <ExcelSectionBlock section={sheet.header} onCellClick={setSelectedCell} />
          )}

          {/* Loose cells at sheet level */}
          {sheet.cells.length > 0 && (
            <div style={{ borderBottom: `1px solid ${excelPaper.cellBorder}` }}>
              <ExcelCellGrid cells={sheet.cells} onCellClick={setSelectedCell} selectedCell={selectedCell} />
            </div>
          )}

          {/* Ranges */}
          {sheet.ranges.map((range, i) => (
            <ExcelRangeBlock key={i} range={range} depth={0} onCellClick={setSelectedCell} selectedCell={selectedCell} />
          ))}

          {/* Footer section */}
          {sheet.footer && sheet.footer.cells.length > 0 && (
            <ExcelSectionBlock section={sheet.footer} onCellClick={setSelectedCell} />
          )}

          {/* Empty state */}
          {sheet.cells.length === 0 && sheet.ranges.length === 0 && !sheet.header && !sheet.footer && (
            <div style={{ padding: 24, textAlign: 'center', color: excelPaper.mutedText, fontSize: 12 }}>{t.excelEmptySheet}</div>
          )}
        </div>
      </div>

      {/* Legend — sits on the paper so its colour samples match the grid */}
      <div style={{
        padding: '4px 12px',
        fontSize: 10,
        color: excelPaper.mutedText,
        borderTop: `1px solid ${excelPaper.cellBorder}`,
        background: excelPaper.headerBg,
        display: 'flex',
        gap: 12,
        flexShrink: 0,
      }}>
        <span><span style={{ color: excelPaper.dynamicText, fontStyle: 'italic' }}>Sample(…)</span> = {t.excelLegendDynamic}</span>
        <span><span style={{ fontWeight: 600 }}>{t.excelLegendConstantWord}</span> = {t.excelLegendConstant}</span>
      </div>

      {/* Sheet tabs at bottom */}
      {sheets.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 0,
          borderTop: `2px solid ${excelColors.sheetTab}`,
          background: 'var(--bg-secondary)',
          padding: '0 8px',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => { setActiveSheet(i); setSelectedCell(null); }}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: i === activeSheet ? 700 : 400,
                cursor: 'pointer',
                border: 'none',
                borderTop: i === activeSheet ? `2px solid ${excelColors.sheetTab}` : '2px solid transparent',
                background: i === activeSheet ? excelColors.cellBg : 'transparent',
                color: i === activeSheet ? excelColors.sheetTab : 'var(--text-secondary)',
                marginTop: -2,
                transition: 'all 0.15s',
              }}
            >
              📃 {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExcelSectionBlock({ section, onCellClick }: { section: ExcelSectionData; onCellClick?: (cell: ExcelCellData) => void }) {
  const isHeader = section.type === 'header';
  return (
    <div style={{
      background: excelPaper.sectionBg,
      borderLeft: `3px solid ${isHeader ? `${excelColors.rangeBorder}66` : excelPaper.cellBorder}`,
      borderBottom: `1px solid ${excelPaper.cellBorder}`,
    }}>
      <div style={{
        padding: '4px 12px',
        fontSize: 11,
        fontWeight: 600,
        color: excelPaper.mutedText,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        {isHeader ? '🔼' : '🔽'} {isHeader ? t.excelHeader : t.excelFooter}
      </div>
      <ExcelCellGrid cells={section.cells} onCellClick={onCellClick} />
    </div>
  );
}

function ExcelRangeBlock({ range, depth, onCellClick, selectedCell }: { range: ExcelRangeData; depth: number; onCellClick?: (cell: ExcelCellData) => void; selectedCell?: ExcelCellData | null }) {
  const repIcon = range.replicationDirection === 'vertical' ? '↕' : range.replicationDirection === 'horizontal' ? '↔' : '';
  return (
    <div style={{
      borderBottom: `1px solid ${excelPaper.cellBorder}`,
      marginLeft: depth * 8,
      borderLeft: depth > 0 ? `2px solid ${excelColors.rangeBorder}44` : undefined,
    }}>
      {/* Range header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        background: excelPaper.rangeBg,
        borderBottom: `1px solid ${excelPaper.cellBorder}`,
      }}>
        <span style={{ fontSize: 13 }}>📐</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: excelPaper.cellText }}>{range.excelRange}</span>
        {range.name !== range.excelRange && (
          <span style={{ fontSize: 11, color: excelPaper.mutedText }}>({range.name})</span>
        )}
        {repIcon && (
          <span style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 3,
            border: `1px solid ${excelColors.rangeBorder}66`,
            color: excelPaper.cellText,
            fontWeight: 600,
          }}>
            {repIcon} {range.replicationDirection === 'vertical' ? t.excelRepeatingVertical : t.excelRepeatingHorizontal}
          </span>
        )}
      </div>

      {/* Cells in this range */}
      {range.cells.length > 0 && (
        <ExcelCellGrid cells={range.cells} onCellClick={onCellClick} selectedCell={selectedCell} />
      )}

      {/* Nested ranges */}
      {range.children.map((child, i) => (
        <ExcelRangeBlock key={i} range={child} depth={depth + 1} onCellClick={onCellClick} selectedCell={selectedCell} />
      ))}
    </div>
  );
}

function ExcelCellGrid({ cells, onCellClick, selectedCell }: { cells: ExcelCellData[]; onCellClick?: (cell: ExcelCellData) => void; selectedCell?: ExcelCellData | null }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 0,
    }}>
      {cells.map((cell, i) => {
        // Values rendered as Sample(...) stand in for data-bound cells; anything
        // else is a constant derived from the binding expression.
        const isDynamic = isSamplePlaceholder(cell.value);
        const hasDistinctAddress = cell.excelRange && cell.excelRange !== cell.name;
        const isSelected = selectedCell?.excelRange === cell.excelRange && selectedCell?.name === cell.name;
        const isHovered = hoveredIndex === i;
        return (
          <div
            key={i}
            onClick={() => onCellClick?.(cell)}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(prev => (prev === i ? null : prev))}
            style={{
            padding: '6px 12px',
            borderRight: `1px solid ${excelPaper.cellBorder}`,
            borderBottom: `1px solid ${excelPaper.cellBorder}`,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
            cursor: 'pointer',
            outline: isSelected
              ? `2px solid ${excelColors.rangeBorder}`
              : isHovered ? `2px solid ${excelColors.rangeBorder}80` : undefined,
            outlineOffset: -2,
            background: isSelected
              ? `${excelColors.rangeBorder}0a`
              : isHovered ? `${excelColors.rangeBorder}12` : undefined,
            transition: 'outline 0.1s, background 0.1s',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
            }}>
              <span style={{
                fontSize: 10,
                color: excelPaper.mutedText,
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {cell.excelRange}
              </span>
              {hasDistinctAddress && (
                <span style={{
                  fontSize: 11,
                  color: excelPaper.cellText,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }} title={cell.name}>
                  {cell.name}
                </span>
              )}
            </div>
            {cell.label && (
              <span style={{
                fontSize: 10,
                color: excelPaper.mutedText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }} title={cell.label}>
                {cell.label}
              </span>
            )}
            <span style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              color: isDynamic ? excelPaper.dynamicText : excelPaper.cellText,
              fontStyle: isDynamic ? 'italic' : undefined,
              fontWeight: isDynamic ? 400 : 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }} title={cell.value}>
              {cell.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
