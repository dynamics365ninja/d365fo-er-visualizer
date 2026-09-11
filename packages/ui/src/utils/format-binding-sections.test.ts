import { describe, it, expect } from 'vitest';
import type { ERFormatBinding, ERFormatElement } from '@er-visualizer/core';
import { buildFormatBindingPresentation } from './format-binding-display';
import {
  buildFormatBindingSections,
  classifyBindingIntent,
  countBindingIntents,
  UNRESOLVED_SECTION_KEY,
} from './format-binding-sections';

const data = (expressionAsString: string) => ({ bindingCategory: 'data' as const, expressionAsString });

describe('classifyBindingIntent', () => {
  it('reads a bare path as a direct value', () => {
    expect(classifyBindingIntent(data('model.InvoiceBase.BackOrders.LineName'))).toBe('direct');
    expect(classifyBindingIntent(data("'$SalesInvoiceTmp_lines'.'Line name'"))).toBe('direct');
    expect(classifyBindingIntent(data('@.Amount'))).toBe('direct');
  });

  it('reads functions and operators as calculations', () => {
    expect(classifyBindingIntent(data('REPLACE(model.CashDiscount.Text, CHAR(10), " ", false)'))).toBe('calculated');
    expect(classifyBindingIntent(data('model.Amount * -1'))).toBe('calculated');
    expect(classifyBindingIntent(data('model.Name & " "'))).toBe('calculated');
  });

  it('reads labels and literals as static text', () => {
    expect(classifyBindingIntent(data('@"GER_LABEL:Description"'))).toBe('text');
    expect(classifyBindingIntent(data('"HD: "'))).toBe('text');
    expect(classifyBindingIntent(data(' 12.5 '))).toBe('text');
    expect(classifyBindingIntent(data('TRUE'))).toBe('text');
  });

  it('keeps visibility and other properties apart from values', () => {
    expect(classifyBindingIntent({ bindingCategory: 'visibility', expressionAsString: 'model.Lines.Count > 0' })).toBe('condition');
    expect(classifyBindingIntent({ bindingCategory: 'visibility', expressionAsString: 'false' })).toBe('condition');
    expect(classifyBindingIntent({ bindingCategory: 'property', expressionAsString: '"invoice.xlsx"' })).toBe('property');
    expect(classifyBindingIntent({ bindingCategory: 'formatting', expressionAsString: 'model.Format' })).toBe('property');
  });
});

function element(id: string, name: string, elementType: string, children: ERFormatElement[] = []): ERFormatElement {
  return { id, name, elementType, children, attributes: {} } as unknown as ERFormatElement;
}

function binding(componentId: string, expressionAsString: string, propertyName = ''): ERFormatBinding {
  return { componentId, expressionAsString, propertyName } as unknown as ERFormatBinding;
}

// Excel ─┬─ Header (range) ─── Title (cell)
//        └─ Lines (range) ─┬─ Name (cell)
//                          ├─ Details (range) ─── Qty (cell)
//                          └─ Amount (cell)
const root = element('root', 'Invoice', 'ExcelFile', [
  element('header', 'Header', 'ExcelRange', [element('title', 'Title', 'ExcelCell')]),
  element('lines', 'Lines', 'ExcelRange', [
    element('name', 'Name', 'ExcelCell'),
    element('details', 'Details', 'ExcelRange', [element('qty', 'Qty', 'ExcelCell')]),
    element('amount', 'Amount', 'ExcelCell'),
  ]),
]);

const bindings = [
  binding('amount', 'model.Lines.Amount * -1'),
  binding('qty', 'model.Lines.Qty'),
  binding('title', '@"GER_LABEL:Invoice"'),
  binding('name', 'model.Lines.Name'),
  binding('lines', 'model.Lines'),
  binding('lines', 'model.Lines.Count > 0', 'Enabled'),
  binding('root', '"invoice.xlsx"', 'FileName'),
  binding('gone', 'model.Stale'),
];

const { groups } = buildFormatBindingPresentation(root, bindings);

describe('buildFormatBindingSections', () => {
  it('follows document order, one section per parent, named by the path below the root', () => {
    const sections = buildFormatBindingSections(root, groups);
    expect(sections.map(s => ({ trail: s.trail, entries: s.entries.map(e => e.group.elementName) }))).toEqual([
      { trail: ['Invoice'], entries: ['Invoice', 'Lines'] },
      { trail: ['Header'], entries: ['Title'] },
      { trail: ['Lines'], entries: ['Name', 'Amount'] },
      { trail: ['Lines', 'Details'], entries: ['Qty'] },
      { trail: [], entries: [expect.any(String)] },
    ]);
  });

  it('collects bindings of elements missing from the tree into their own section', () => {
    const last = buildFormatBindingSections(root, groups).at(-1)!;
    expect(last.key).toBe(UNRESOLVED_SECTION_KEY);
    expect(last.unresolved).toBe(true);
    expect(last.entries[0].bindings[0].expressionAsString).toBe('model.Stale');
  });

  it('drops filtered-out bindings, and elements and sections left empty', () => {
    const sections = buildFormatBindingSections(root, groups, b => classifyBindingIntent(b) === 'calculated');
    expect(sections).toHaveLength(1);
    expect(sections[0].trail).toEqual(['Lines']);
    expect(sections[0].entries.map(e => e.group.elementName)).toEqual(['Amount']);
  });

  it('keeps only the matching bindings of an element that has several', () => {
    const sections = buildFormatBindingSections(root, groups, b => classifyBindingIntent(b) === 'condition');
    expect(sections[0].entries[0].group.bindings).toHaveLength(2);
    expect(sections[0].entries[0].bindings.map(b => b.propertyName)).toEqual(['Enabled']);
  });
});

describe('countBindingIntents', () => {
  it('counts every binding once, under its intent', () => {
    expect(countBindingIntents(groups)).toEqual({ direct: 4, calculated: 1, condition: 1, text: 1, property: 1 });
  });
});
