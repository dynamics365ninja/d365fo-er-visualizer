/**
 * Plausible sample values for a format preview. A value is chosen from what
 * is known about the field — the model field's type and name, the element's
 * data type, its length and format mask, the enum it reads — and varies with
 * the record number, so two sample lines of a list do not look identical.
 * Deterministic: the same element always gets the same value.
 */
import { constantValue, parseFunctionCall } from './er-references';
import type { ElementConstraints } from './format-lineage';

export interface SampleInput {
  /** Names to read the meaning from, most specific first (model field, element). */
  names: string[];
  /** The formula that computes the value: the results it picks from and the format it writes tell the value's shape. */
  formula?: string;
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

const AMOUNT = /(amount|amt|sum|total|price|base|gross|net|value|castka|cena|zaklad|zakl_|saldo|debit|credit|balance|obrat|tax(amount)?$|dph$)/;
const QUANTITY = /(qty|quantity|mnozstvi|pocet|count)/;
const PERCENT = /(percent|pct|rate|sazba|procent)/;
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');

const sampleDate = (seed: number, iteration: number) => new Date(2026, 2 + (iteration % 3), 14 + (seed % 14), 9 + (seed % 8), (seed % 4) * 15);
const sampleAmount = (seed: number, iteration: number) => Math.round(((seed % 90000) + 1000) * (iteration + 1)) / 100;

/** Placeholder text that differs from field to field and record to record. */
function sampleText(seed: number, maxLength: number | undefined): string {
  if (maxLength && maxLength <= 4) {
    return Array.from({ length: maxLength }, (_, i) => String.fromCharCode(65 + (Math.floor(seed / 26 ** i) % 26))).join('');
  }
  const start = seed % LOREM.length;
  const words = Array.from({ length: 2 + (seed % 2) }, (_, i) => LOREM[(start + i) % LOREM.length]).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The value a formula would give, as far as its shape tells: one of the
 * literal results an `IF` or `CASE` picks from, a date or number in the
 * format `DATEFORMAT` / `NUMBERFORMAT` writes, a sum. `undefined` when the
 * formula only passes data on — the names then decide.
 */
function fromFormula(formula: string, seed: number, iteration: number, constraints: ElementConstraints, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  const literal = constantValue(formula);
  if (literal !== null) return literal.startsWith('@"') ? undefined : literal;
  const call = parseFunctionCall(formula);
  if (!call) {
    // Sums and counts added up: still a number.
    return /^\s*(SUMIFS?|SUM|ABS|ROUND\w*)\s*\(/i.test(formula) ? formatSampleNumber(sampleAmount(seed, iteration), constraints.format ?? '0.00') : undefined;
  }
  const nested = (expr: string | undefined) => (expr ? fromFormula(expr, seed, iteration, constraints, depth + 1) : undefined);
  switch (call.name) {
    case 'IF':
    case 'CASE': {
      const results = call.args
        .map((arg, i) => ({ arg, i }))
        .filter(({ i }) => (call.name === 'IF' ? i === 1 || i === 2 : i > 0 && (i % 2 === 0 || i === call.args.length - 1)))
        .map(({ arg }) => nested(arg))
        .filter((value): value is string => Boolean(value));
      return results.length > 0 ? pick(results, seed) : undefined;
    }
    case 'DATEFORMAT':
    case 'DATETIMEFORMAT': {
      const format = constantValue(call.args[1] ?? '') ?? constraints.format;
      return formatSampleDate(sampleDate(seed, iteration), format, call.name === 'DATETIMEFORMAT' || /[Hh]/.test(format ?? ''));
    }
    case 'SESSIONTODAY':
    case 'TODAY':
      return formatSampleDate(sampleDate(seed, iteration), constraints.format, false);
    case 'SESSIONNOW':
    case 'NOW':
      return formatSampleDate(sampleDate(seed, iteration), constraints.format, true);
    case 'YEAR':
      return '2026';
    case 'MONTH':
      return String(1 + (seed % 12));
    case 'NUMBERFORMAT':
      return formatSampleNumber(sampleAmount(seed, iteration), constantValue(call.args[1] ?? '') ?? constraints.format);
    case 'SUM':
    case 'SUMIF':
    case 'SUMIFS':
    case 'ABS':
    case 'ROUND':
    case 'ROUNDAMOUNT':
    case 'ROUNDDOWN':
    case 'ROUNDUP':
      return formatSampleNumber(sampleAmount(seed, iteration), constraints.format ?? '0.00');
    case 'COUNT':
    case 'COUNTIF':
    case 'COUNTIFS':
    case 'LEN':
      return String(1 + (seed % 9));
    case 'UPPER':
      return nested(call.args[0])?.toUpperCase();
    case 'LOWER':
      return nested(call.args[0])?.toLowerCase();
    case 'TRIM':
    case 'TEXT':
      return nested(call.args[0]);
    default:
      return undefined;
  }
}

/** A sample value for one field. */
export function sampleValue(input: SampleInput): string {
  const { dataType, constraints, iteration } = input;
  const names = input.names.filter(Boolean).map(fold);
  const name = names.join(' ');
  const context = (input.context ?? []).filter(Boolean).map(fold).join(' ');
  const seed = hash(`${input.seed}|${iteration}`);
  const fit = (text: string) => (constraints.maxLength && text.length > constraints.maxLength ? text.slice(0, constraints.maxLength).trimEnd() : text);

  // What the formula picks from is closer to the value than the enum it tests.
  const computed = input.formula ? fromFormula(input.formula, seed, iteration, constraints) : undefined;
  if (computed !== undefined) return fit(computed);
  if (input.enumValues && input.enumValues.length > 0) return fit(pick(input.enumValues, seed));
  if (input.modelType === 1 || /^(is|has)[a-z]|flag|enabled|active/.test(name)) return pick(['true', 'false'], seed);

  const isDate = dataType === 'DateTime' || input.modelType === 7 || input.modelType === 14
    || (/(date|datum|birth|narozen)/.test(name) && dataType !== 'Real');
  if (isDate) {
    const withTime = input.modelType === 14 || /time|cas/.test(name);
    return formatSampleDate(sampleDate(seed, iteration), constraints.format, withTime);
  }

  const isNumber = dataType === 'Real' || [3, 4, 5].includes(input.modelType ?? 0);
  if (isNumber) {
    let value: number;
    let decimals = false;
    if (QUANTITY.test(name)) value = 1 + (seed % 12);
    else if (PERCENT.test(name)) value = pick([21, 12, 0], seed);
    else if (/(linenum|line ?no|number|seq|poradi|index)/.test(name)) value = iteration + 1;
    else if (/(recid|id$)/.test(name) || input.modelType === 3) value = 5637144576 + (seed % 10000);
    else if (AMOUNT.test(name) || input.modelType === 5) {
      value = sampleAmount(seed, iteration);
      decimals = true;
    } else value = seed % 100;
    if (constraints.format && /^0+$/.test(constraints.format) && !Number.isInteger(value)) value = Math.round(value * 100);
    return fit(formatSampleNumber(value, constraints.format ?? (decimals ? '0.00' : undefined)));
  }

  if (dataType === 'Container') return 'UEsDBBQAAAAI…';

  const party = /(company|firma|seller|supplier|vendor|dodavatel|legalentity)/.test(context) ? 'company'
    : /(customer|buyer|odberatel|zakaznik|cust\b|debtor|counterparty|partner)/.test(context) ? 'customer'
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
    if (/(streetnumber|housenumber|building|orient|c_pop)/.test(name)) return String(1 + (seed % 2400));
    if (/(street|ulice|address|adresa)/.test(name)) return pick(['Dlouhá 15', 'Masarykova 21', 'Nová 8'], seed);
    if (/(email|mail)/.test(name)) return pick(['fakturace@contoso.cz', 'info@fabrikam.cz'], seed);
    if (/(phone|telefon|tel)/.test(name)) return constraints.maxLength && constraints.maxLength < 16 ? pick(['601234567', '777123456'], seed) : pick(['+420 601 234 567', '+420 777 123 456'], seed);
    if (/(firstname|^jmeno|_jmeno)/.test(name)) return pick(['Jan', 'Petra', 'Tomáš', 'Eva'], seed);
    if (/(lastname|surname|prijmeni)/.test(name)) return pick(['Novák', 'Svobodová', 'Dvořák', 'Černá'], seed);
    if (/(persontitle|^titul|^title)/.test(name)) return pick(['Ing.', 'Mgr.', 'Bc.'], seed);
    if (/(invoice|faktur|voucher|doklad|document)/.test(name) && /(id|num|no|cislo)/.test(name)) return `INV-2026-${String(1000 + (seed % 9000))}`;
    if (/(item|product|polozk|zbozi)/.test(name) && /(id|num|code)/.test(name)) return pick(['D0001', 'A1000', 'P-2040', 'M-0310'], seed);
    if (/(account|ucet)/.test(name)) return pick(['US-001', 'C000123', 'V-1001'], seed);
    if (/(unit|jednotk|uom)/.test(name)) return pick(['ks', 'pcs', 'kg'], seed);
    if (/(organi[sz]ation|organizace)/.test(name)) return pick(['Adventure Works s.r.o.', 'Litware a.s.', 'Contoso s.r.o.', 'Fabrikam a.s.'], seed);
    if (/(company|firma|seller|supplier|vendor|dodavatel)/.test(name) || (party === 'company' && /(name|nazev)/.test(name))) return pick(['Contoso s.r.o.', 'Fabrikam a.s.'], seed);
    if (/(customer|buyer|odberatel|zakaznik)/.test(name) || (party === 'customer' && /(name|nazev)/.test(name))) return pick(['Adventure Works s.r.o.', 'Litware a.s.'], seed);
    if (/(description|popis|text|note|poznamk|comment)/.test(name)) return pick(['Kancelářská židle ergonomická', 'Servisní práce', 'Doprava', 'Monitor 27 palců'], seed);
    if (/(name|nazev|jmeno)/.test(name)) return pick(['Kancelářská židle', 'Stůl dubový', 'Monitor 27 palců'], seed);
    if (/(code|kod|type|typ|category|group)/.test(name)) return pick(['A01', 'STD', 'VAT21'], seed);
    if (/^(id|num|number|no|cislo)$/.test(names[0] ?? '') && /(invoice|faktur|header)/.test(context)) return `INV-2026-${String(1000 + (seed % 9000))}`;
    if (/(id|num|no|cislo|ref)/.test(name)) {
      const prefix = (input.names.find(Boolean) ?? '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ID';
      return `${prefix}-${100 + (seed % 900)}`;
    }
    return sampleText(seed, constraints.maxLength);
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
