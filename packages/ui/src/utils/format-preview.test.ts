import { describe, expect, it } from 'vitest';
import type { ERFormatContent } from '@er-visualizer/core';
import { buildFormatLineage } from './format-lineage';
import { buildPreviewDocument, lineElementKeys, type PreviewOptions } from './format-preview';
import { invoiceWorkspace } from './invoice-workspace.test-fixture';

const configs = invoiceWorkspace();
const words = {
  repeats: (source: string, n: number) => `repeat ${source} x${n}`,
  condition: (expression: string) => `when ${expression}`,
  optional: 'optional',
};
const text = (doc: ReturnType<typeof buildPreviewDocument>, withNotes = false) => doc.lines
  .filter(line => withNotes || !line.note)
  .map(line => line.note ? `# ${line.note.text}` : `${'  '.repeat(line.indent)}${line.segments.map(s => s.text).join('')}`);
const build = (index: number, kind: 'xml' | 'text', options: Partial<PreviewOptions> = {}) => {
  const lineage = buildFormatLineage(configs, index)!;
  const root = (configs[index].content as ERFormatContent).formatVersion.format.rootElement;
  return buildPreviewDocument(lineage, root, kind, { mode: 'sample', iterations: 2, hideUnbound: false, ...options }, words);
};

describe('buildPreviewDocument — XML', () => {
  it('writes values inline and constants as they are', () => {
    const lines = text(build(2, 'xml'));
    expect(lines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(lines[1]).toBe('<Invoice version="1.0">');
    expect(lines.find(l => l.includes('<InvoiceNumber>'))).toMatch(/^ {2}<InvoiceNumber>INV-2026-\d{4}<\/InvoiceNumber>$/);
  });

  it('writes a repeating element once per sample record, with a note', () => {
    const doc = build(2, 'xml');
    expect(text(doc).filter(l => l.trim() === '<Line>')).toHaveLength(2);
    expect(text(doc, true)).toContain('# repeat model.InvoiceBase.Lines x2');
    const itemLines = doc.lines.filter(l => l.segments.some(s => s.role === 'tag' && s.text === 'ItemId'));
    expect(itemLines.every(l => l.bands.some(b => b.kind === 'repeat'))).toBe(true);
  });

  it('marks conditional and unbound elements', () => {
    const doc = build(2, 'xml');
    expect(text(doc, true)).toContain('# when model.InvoiceBase.Notes <> ""');
    const bic = doc.lines.find(l => l.segments.some(s => s.text === 'BIC'))!;
    expect(bic.segments.some(s => s.role === 'unbound')).toBe(true);
    expect(text(build(2, 'xml', { hideUnbound: true })).some(l => l.includes('BIC'))).toBe(false);
  });

  it('shows sources or expressions instead of sample data on request', () => {
    expect(text(build(2, 'xml', { mode: 'source' })).find(l => l.includes('<ItemId>'))).toContain('{CustInvoiceTrans.ItemId}');
    expect(text(build(2, 'xml', { mode: 'expression' })).find(l => l.includes('<ItemId>'))).toContain('{@.ItemId}');
  });
});

describe('buildPreviewDocument — text', () => {
  it('joins fields with the delimiter and ends records with the line end', () => {
    const lines = text(build(3, 'text'));
    expect(lines[0]).toBe('InvoiceId;ItemId');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^INV-2026-\d{4};\S+$/);
  });
});

describe('buildPreviewDocument — sample consistency', () => {
  it('gives one model field the same value everywhere and varies only per-record values', () => {
    const lines = text(build(2, 'xml'));
    const invoiceNumber = /<InvoiceNumber>(.*)<\/InvoiceNumber>/.exec(lines.join('\n'))![1];
    const csv = text(build(3, 'text'));
    const [first, second] = csv.slice(1).map(line => line.split(';'));
    expect(first[0]).toBe(second[0]);
    expect(invoiceNumber).toMatch(/^INV-2026-\d{4}$/);
  });

  it('reads the party from the context', () => {
    const seller = text(build(2, 'xml')).find(l => l.includes('<SellerName>'))!;
    expect(seller).toMatch(/Contoso|Fabrikam/);
  });
});

describe('lineElementKeys', () => {
  it('names the elements of a line\'s values and of the sections it sits in, normalized', () => {
    // What lets a hover or a selection re-render only the lines that show the
    // element, instead of a document of thousands of segments.
    const keys = lineElementKeys({
      segments: [
        { text: '<Amount>', role: 'tag' },
        { text: '100', role: 'value', elementId: '{AAAAAAAA-0000-4000-8000-000000000001}' },
        { text: '</Amount>', role: 'tag' },
      ],
      bands: [{ elementId: 'bbbbbbbb-0000-4000-8000-000000000002', kind: 'repeat' }],
    });
    expect([...keys].sort()).toEqual([
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002',
    ]);
  });

  it('finds an element on every line it appears on', () => {
    // A value inside a repeating section is written out once per record: a
    // hover over one of them highlights them all.
    const counts = new Map<string, number>();
    for (const line of build(2, 'xml', { iterations: 3 }).lines) {
      for (const key of lineElementKeys(line)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });
});
