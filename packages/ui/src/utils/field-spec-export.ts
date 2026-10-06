/**
 * The field specification of a format as a CSV file — the table consultants
 * paste into a mapping document or hand to a customer. Semicolons and a BOM,
 * so Excel opens it in the right columns and with the right characters in a
 * Czech as well as an English locale.
 */
import { t } from '../i18n';
import { primaryValueSources, type ElementFill } from './format-lineage';

export type Occurrence = 'always' | 'optional' | 'repeating' | 'conditional';

/** How often the element shows up in the output. */
export function elementOccurrence(row: Pick<ElementFill, 'repeating' | 'optional' | 'conditions'>): Occurrence {
  if (row.repeating) return 'repeating';
  if (row.conditions.length > 0) return 'conditional';
  if (row.optional) return 'optional';
  return 'always';
}

function csvCell(value: string | number | undefined): string {
  const text = value == null ? '' : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface FieldSpecCsvOptions {
  /** Resolves a model field label reference to text. */
  labelFor?: (labelRef: string | undefined) => string | undefined;
  /** Data type in the words the reader expects. */
  dataTypeLabel?: (dataType: string) => string | undefined;
}

export function buildFieldSpecCsv(rows: readonly ElementFill[], options: FieldSpecCsvOptions = {}): string {
  const lines = [t.specCsvHeaders.map(csvCell).join(';')];
  for (const row of rows) {
    const value = row.modelLinks.find(link => link.role === 'value');
    const valueLinks = row.modelLinks.filter(link => link.role === 'value');
    const context = row.sources.filter(src => src.role === 'context' && (src.kind === 'table' || src.kind === 'parameter'));
    const cells = [
      row.path.slice(1).join('/'),
      row.displayName,
      row.element.elementType,
      row.isField ? (options.dataTypeLabel?.(row.dataType) ?? row.dataType) : '',
      t.specOccurrence[elementOccurrence(row)],
      row.constraints.minLength,
      row.constraints.maxLength,
      row.constraints.format,
      t.fillKindLabels[row.fill],
      row.binding,
      row.conditions.join(' | '),
      valueLinks.map(link => link.path).join(', '),
      value?.field ? options.labelFor?.(value.field.label) : undefined,
      valueLinks.map(link => link.fill?.expression).filter(Boolean).join(' | '),
      primaryValueSources(row).map(src => src.name).join(', '),
      context.map(src => src.name).join(', '),
    ];
    lines.push(cells.map(cell => csvCell(cell)).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Offer `text` as a file download in the browser. */
export function downloadTextFile(fileName: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name safe on every OS, from a configuration name. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'format';
}
