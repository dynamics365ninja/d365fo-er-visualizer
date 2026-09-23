import { type ERFormatElement } from '@er-visualizer/core';

// ── Format file preview ──

export type BindingMap = Map<string, import('../../utils/format-binding-display').NormalizedFormatBinding[]>;

/**
 * Try to extract a fixed (constant) value from a binding expression string.
 * Returns the constant if the expression is a pure double-quoted string literal
 * (e.g. `"HD: "`), a number, or a boolean.
 * Returns '' for dynamic expressions — data paths like
 * `'Control statement'.'$A5'.aggregated.'$TaxBaseStd'` use single-quoted
 * identifiers joined by `'.'` and must be rejected.
 */
function extractConstantFromExpression(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return '';
  // Only double-quoted strings are ER string constants.
  // Single quotes are used for identifier quoting in paths.
  const strMatch = trimmed.match(/^"([^"]*)"$/);
  if (strMatch) return strMatch[1];
  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  // Boolean
  if (trimmed === 'true' || trimmed === 'false') return trimmed;
  // Everything else is dynamic — no constant
  return '';
}

export type PreviewPlaceholderMode = 'sample' | 'omit' | 'braces';

export type PreviewRenderOptions = {
  placeholderMode: PreviewPlaceholderMode;
  /** Consultant mode must not see raw ER element type names in the preview. */
  showTechnicalDetails?: boolean;
};

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickByHash(values: string[], seed: string): string {
  if (values.length === 0) return '';
  return values[hashString(seed) % values.length];
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sampleValueForElement(el: ERFormatElement): string {
  const name = el.name ?? '';
  const seed = `${el.id}|${el.name}|${el.elementType}`;
  const lower = normalizeForMatch(name);
  const numericLikeName = /(amount|sum|total|price|tax|base|castka|sazba|rate|percent|pct|qty|quantity|count|pocet|index|poradi|id|number|num|cislo|ref|value|hodnota|saldo|debit|credit|net|gross|subtotal)/.test(lower);

  if (el.elementType === 'Numeric') {
    return pickByHash(['0', '1', '12', '105.45', '999.99'], seed);
  }
  if (numericLikeName) return pickByHash(['0', '1', '12', '105.45', '999.99'], seed);
  if (el.elementType === 'DateTime') {
    return pickByHash(['2026-01-15', '2026-03-31', '2026-06-01T10:30:00'], seed);
  }
  if (/(is|has|flag|enabled|active|valid|platny|aktivni)/.test(lower)) return pickByHash(['true', 'false'], seed);
  if (/(date|datum)/.test(lower)) return pickByHash(['2026-01-15', '2026-03-31'], seed);
  if (/(time|cas)/.test(lower)) return pickByHash(['10:30:00', '14:05:22'], seed);
  if (/(vat|dic)/.test(lower)) return pickByHash(['CZ699001234', 'CZ12345678'], seed);
  if (/(ico)/.test(lower)) return pickByHash(['12345678', '27654321'], seed);
  if (/(code|kod)/.test(lower)) return pickByHash(['A001', 'INV001', 'DOC2026'], seed);
  if (/(name|nazev|company|firma|customer|partner)/.test(lower)) return pickByHash(['Contoso s.r.o.', 'Fabrikam a.s.', 'Adventure Works'], seed);
  if (/(city|mesto)/.test(lower)) return pickByHash(['Praha', 'Brno', 'Ostrava'], seed);
  if (/(street|ulice)/.test(lower)) return pickByHash(['Dlouha 15', 'Masarykova 21', 'Nova 8'], seed);
  if (/(zip|psc|postal)/.test(lower)) return pickByHash(['11000', '60200', '70200'], seed);
  if (/(country|stat)/.test(lower)) return pickByHash(['CZ', 'SK', 'DE'], seed);

  return `Sample(${name || 'Value'})`;
}

/** True for the synthetic `Sample(...)` placeholders produced by sampleValueForElement. */
export function isSamplePlaceholder(value: string): boolean {
  return /^Sample\(.*\)$/.test(value);
}

/** Format an element's preview value: constant from binding expression or configurable unresolved fallback.
 *  el.value is always an expression path in ER format XML, never a display constant — skip it. */
export function previewValue(el: ERFormatElement, bindingMap: BindingMap, options: PreviewRenderOptions): string {
  const bindings = bindingMap.get(el.id);
  if (bindings) {
    const dataBinding = bindings.find(b => b.bindingCategory === 'data');
    if (dataBinding?.expressionAsString) {
      const constant = extractConstantFromExpression(dataBinding.expressionAsString);
      if (constant) return constant;
    }
  }
  if (options.placeholderMode === 'omit') return '';
  if (options.placeholderMode === 'sample') return sampleValueForElement(el);
  return `{${el.name}}`;
}

// ── Visual Excel Spreadsheet Preview ──
