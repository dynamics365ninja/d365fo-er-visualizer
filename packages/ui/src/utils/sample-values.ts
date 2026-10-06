/**
 * Plausible sample values for a format preview. A value is chosen from what
 * is known about the field — the model field's type and name, the element's
 * data type, its length and format mask, the enum it reads — and varies with
 * the record number, so two sample lines of a list do not look identical.
 * Deterministic: the same element always gets the same value.
 */
import type { ElementConstraints } from './format-lineage';

export interface SampleInput {
  /** Names to read the meaning from, most specific first (model field, element). */
  names: string[];
  /** Where the field sits (parent records, enclosing elements) — tells a seller's name from a customer's. */
  context?: string[];
  /** Format data type: String, Real, DateTime, Container, … */
  dataType: string;
  /** ER model field type code, when the value comes from a model field. */
  modelType?: number;
  /** Enum values the value can take. */
  enumValues?: string[];
  constraints: ElementConstraints;
  /** Stable seed — the element id. */
  seed: string;
  /** Record number inside the enclosing lists, 0-based. */
  iteration: number;
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(values: readonly T[], seed: number): T {
  return values[seed % values.length];
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A date in `format` (`yyyy-MM-dd`, `ddMMyy`, `dd.MM.yyyy HH:mm`, …). */
export function formatSampleDate(date: Date, format: string | undefined, withTime: boolean): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  if (!format) {
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:00` : day;
  }
  return format.replace(/yyyy|yy|MM|dd|HH|hh|mm|ss/g, token => {
    switch (token) {
      case 'yyyy': return String(date.getFullYear());
      case 'yy': return pad(date.getFullYear() % 100);
      case 'MM': return pad(date.getMonth() + 1);
      case 'dd': return pad(date.getDate());
      case 'HH': case 'hh': return pad(date.getHours());
      case 'mm': return pad(date.getMinutes());
      case 'ss': return pad(date.getSeconds());
      default: return token;
    }
  });
}

/** A number written the way a format mask (`0.00`, `000000`, `#,##0.###`) asks. */
export function formatSampleNumber(value: number, mask: string | undefined): string {
  if (!mask) return Number.isInteger(value) ? String(value) : value.toFixed(2);
  const [intMask, fracMask = ''] = mask.split('.');
  const decimals = fracMask.replace(/[^0#]/g, '').length;
  const required = fracMask.replace(/[^0]/g, '').length;
  const [intPart, rawFrac = ''] = Math.abs(value).toFixed(decimals).split('.');
  let fraction = rawFrac;
  // `#` places are optional: trailing zeros there are dropped.
  while (fraction.length > required && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  let integer = intPart.padStart(intMask.replace(/[^0]/g, '').length, '0');
  if (intMask.includes(',')) integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

const AMOUNT = /(amount|amt|sum|total|price|base|gross|net|value|castka|cena|zaklad|saldo|debit|credit|balance|tax(amount)?$|dph$)/;
const QUANTITY = /(qty|quantity|mnozstvi|pocet|count)/;
const PERCENT = /(percent|pct|rate|sazba|procent)/;

/** A sample value for one field. */
export function sampleValue(input: SampleInput): string {
  const { dataType, constraints, iteration } = input;
  const names = input.names.filter(Boolean).map(fold);
  const name = names.join(' ');
  const context = (input.context ?? []).filter(Boolean).map(fold).join(' ');
  const seed = hash(`${input.seed}|${iteration}`);
  const fit = (text: string) => (constraints.maxLength && text.length > constraints.maxLength ? text.slice(0, constraints.maxLength) : text);

  if (input.enumValues && input.enumValues.length > 0) return fit(pick(input.enumValues, seed));
  if (input.modelType === 1 || /^(is|has)[a-z]|flag|enabled|active/.test(name)) return 'true';

  const isDate = dataType === 'DateTime' || input.modelType === 7 || input.modelType === 14 || (/(date|datum)/.test(name) && dataType !== 'Real');
  if (isDate) {
    const date = new Date(2026, 2 + (iteration % 3), 14 + (seed % 14), 9 + (seed % 8), (seed % 4) * 15);
    const withTime = input.modelType === 14 || /time|cas/.test(name);
    return formatSampleDate(date, constraints.format, withTime);
  }

  const isNumber = dataType === 'Real' || [3, 4, 5].includes(input.modelType ?? 0);
  if (isNumber) {
    let value: number;
    if (QUANTITY.test(name)) value = 1 + (seed % 12);
    else if (PERCENT.test(name)) value = pick([21, 12, 0], seed);
    else if (/(linenum|line ?no|number|seq|poradi|index)/.test(name)) value = iteration + 1;
    else if (/(recid|id$)/.test(name) || input.modelType === 3) value = 5637144576 + (seed % 10000);
    else if (AMOUNT.test(name) || input.modelType === 5) value = Math.round(((seed % 90000) + 1000) * (iteration + 1)) / 100;
    else value = seed % 100;
    if (constraints.format && /^0+$/.test(constraints.format) && !Number.isInteger(value)) value = Math.round(value * 100);
    return fit(formatSampleNumber(value, constraints.format));
  }

  if (dataType === 'Container') return 'UEsDBBQAAAAI…';

  const party = /(company|firma|seller|supplier|vendor|dodavatel|legalentity)/.test(context) ? 'company'
    : /(customer|buyer|odberatel|zakaznik|cust\b|debtor)/.test(context) ? 'customer'
    : undefined;
  const text = (() => {
    if (/iban/.test(name)) return pick(['CZ6508000000192000145399', 'SK3112000000198742637541'], seed);
    if (/(bic|swift)/.test(name)) return pick(['GIBACZPX', 'KOMBCZPP'], seed);
    if (/(vat|dic|taxreg|tax ?id)/.test(name)) return pick(['CZ12345678', 'CZ699001234', 'SK2020123456'], seed);
    if (/(ico|regnum|registration|coregnum)/.test(name)) return pick(['12345678', '27654321'], seed);
    if (/(currency|curr|ccy|mena)/.test(name)) return pick(['CZK', 'EUR'], seed);
    if (/(country|region|stat|zeme)/.test(name)) return pick(['CZ', 'SK', 'DE'], seed);
    if (/(zip|postal|psc)/.test(name)) return pick(['110 00', '602 00', '702 00'], seed);
    if (/(city|town|mesto|obec)/.test(name)) return pick(['Praha', 'Brno', 'Ostrava'], seed);
    if (/(street|ulice|address|adresa)/.test(name)) return pick(['Dlouhá 15', 'Masarykova 21', 'Nová 8'], seed);
    if (/(email|mail)/.test(name)) return pick(['fakturace@contoso.cz', 'info@fabrikam.cz'], seed);
    if (/(phone|telefon|tel)/.test(name)) return '+420 601 234 567';
    if (/(invoice|faktur|voucher|doklad)/.test(name) && /(id|num|no|cislo)/.test(name)) return `INV-2026-${String(1000 + (seed % 9000))}`;
    if (/(item|product|polozk|zbozi)/.test(name) && /(id|num|code)/.test(name)) return pick(['D0001', 'A1000', 'P-2040', 'M-0310'], seed);
    if (/(account|ucet)/.test(name)) return pick(['US-001', 'C000123', 'V-1001'], seed);
    if (/(unit|jednotk|uom)/.test(name)) return pick(['ks', 'pcs', 'kg'], seed);
    if (/(company|firma|seller|supplier|vendor|dodavatel)/.test(name) || (party === 'company' && /(name|nazev)/.test(name))) return pick(['Contoso s.r.o.', 'Fabrikam a.s.'], seed);
    if (/(customer|buyer|odberatel|zakaznik)/.test(name) || (party === 'customer' && /(name|nazev)/.test(name))) return pick(['Adventure Works s.r.o.', 'Litware a.s.'], seed);
    if (/(description|popis|text|note|poznamk|comment)/.test(name)) return pick(['Kancelářská židle ergonomická', 'Servisní práce', 'Doprava', 'Monitor 27 palců'], seed);
    if (/(name|nazev|jmeno)/.test(name)) return pick(['Kancelářská židle', 'Stůl dubový', 'Monitor 27 palců'], seed);
    if (/(code|kod|type|typ|category|group)/.test(name)) return pick(['A01', 'STD', 'VAT21'], seed);
    if (/^(id|num|number|no|cislo)$/.test(names[0] ?? '') && /(invoice|faktur|header)/.test(context)) return `INV-2026-${String(1000 + (seed % 9000))}`;
    if (/(id|num|no|cislo|ref)/.test(name)) return `${(input.names[0] ?? 'ID').slice(0, 3).toUpperCase()}-${100 + (seed % 900)}`;
    return input.names.find(Boolean) ?? 'Text';
  })();
  return fit(text);
}

/**
 * A value laid out in a fixed-width field: padded to the minimum length
 * with the padding character (spaces by default), on the side the alignment
 * says, and cut at the maximum length.
 */
export function layoutFixed(value: string, constraints: ElementConstraints): { text: string; padding: string; padLeft: boolean } {
  const width = constraints.minLength;
  let text = constraints.maxLength && value.length > constraints.maxLength ? value.slice(0, constraints.maxLength) : value;
  if (!width || text.length >= width) return { text, padding: '', padLeft: false };
  const pad = (constraints.padding ?? ' ').charAt(0) || ' ';
  const padLeft = /right/i.test(constraints.alignment ?? '') || (pad === '0' && !constraints.alignment);
  const padding = pad.repeat(width - text.length);
  text = text.slice(0, width);
  return { text, padding, padLeft };
}
