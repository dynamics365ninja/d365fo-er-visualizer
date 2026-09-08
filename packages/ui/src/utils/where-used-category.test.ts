import { describe, it, expect } from 'vitest';
import { referenceCategory, WHERE_USED_CATEGORY_ORDER } from './where-used-category';

describe('referenceCategory', () => {
  it('puts format element references in the structure section', () => {
    expect(referenceCategory({ kind: 'formatElement', kindLabel: 'ExcelCell' })).toBe('structure');
    // Format element types are open-ended, so nothing about the label may
    // divert a format reference away from its section.
    expect(referenceCategory({ kind: 'formatElement', kindLabel: 'calc' })).toBe('structure');
  });

  it('treats plain mapping bindings as bindings', () => {
    expect(referenceCategory({ kind: 'binding', kindLabel: 'binding' })).toBe('bindings');
    expect(referenceCategory({ kind: 'binding', kindLabel: '  Binding ' })).toBe('bindings');
    expect(referenceCategory({ kind: 'binding', kindLabel: 'binding for lines' })).toBe('bindings');
  });

  it('routes the expression-shaped scan codes to the expressions section', () => {
    for (const kindLabel of ['calc', 'param', 'agg', 'validation', 'message']) {
      expect(referenceCategory({ kind: 'binding', kindLabel })).toBe('expressions');
    }
  });

  it('orders sections from the most common reason for a hit to the least', () => {
    expect(WHERE_USED_CATEGORY_ORDER).toEqual(['bindings', 'expressions', 'structure']);
  });
});
