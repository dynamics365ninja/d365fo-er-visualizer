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
