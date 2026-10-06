/**
 * Reading the data references out of an ER expression.
 *
 * An ER formula names data with dotted paths — `model.InvoiceBase.Lines`,
 * `'$Invoice'.InvoiceId`, `@.Qty`, `$Company.postalAddress().City` — mixed with
 * function calls (`WHERE(…)`), string literals (`"INV_"`), label references
 * (`@"GER_LABEL:X"`, `@SYS123`) and numbers. Lineage, where-used and search
 * all need the paths, with each segment unquoted, and they need to know which
 * argument of a list function is the list itself and which is only a filter.
 */

export interface ExpressionReference {
  /** Segments as names: quotes dropped, `''` unescaped; a method call keeps its `()`. */
  segments: string[];
  /** The path starts at the current record (`@.Field`). */
  current: boolean;
  /** Offset of the first character of the path in the expression. */
  start: number;
  /** Offset just past the last character of the path. */
  end: number;
}

const IDENT_START = /[\p{L}_$#]/u;
const IDENT_PART = /[\p{L}\p{N}_$#]/u;
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null']);

function skipSpaces(expr: string, i: number): number {
  while (i < expr.length && /\s/.test(expr[i])) i++;
  return i;
}

/** End offset (exclusive) of a quoted token starting at `i`; `''` / `""` escape the quote. */
function quotedEnd(expr: string, i: number): number {
  const quote = expr[i];
  let j = i + 1;
  while (j < expr.length) {
    if (expr[j] === quote) {
      if (expr[j + 1] === quote) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return j;
}

function unquote(token: string): string {
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replace(/''/g, "'");
  }
  return token;
}

/** Offset just past the parenthesis matching the `(` at `i`, quotes respected. */
export function matchingParen(expr: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < expr.length) {
    const ch = expr[j];
    if (ch === '"' || ch === "'") { j = quotedEnd(expr, j); continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return expr.length;
}

/** Reads one identifier or quoted name at `i`; `null` when there is none. */
function readName(expr: string, i: number): { name: string; end: number } | null {
  const ch = expr[i];
  if (ch === "'") {
    const end = quotedEnd(expr, i);
    return { name: unquote(expr.slice(i, end)), end };
  }
  if (ch && IDENT_START.test(ch)) {
    let j = i + 1;
    while (j < expr.length && IDENT_PART.test(expr[j])) j++;
    return { name: expr.slice(i, j), end: j };
  }
  return null;
}

/**
 * Every data path in `expr`, in order of appearance. Function names, keywords,
 * literals and label references are skipped; the arguments of a function or
 * method call are searched as well.
 */
export function extractReferences(expr: string, offset = 0): ExpressionReference[] {
  const refs: ExpressionReference[] = [];
  if (!expr) return refs;
  let i = 0;
  // A path that follows `)` or `]` addresses the result of an unnamed
  // expression (`FIRSTORNULL(x).Name`): its segments are not references.
  let afterValue = false;

  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '"') { i = quotedEnd(expr, i); afterValue = true; continue; }

    if (ch === '@') {
      const next = expr[i + 1];
      if (next === '"') { i = quotedEnd(expr, i + 1); afterValue = true; continue; }
      const dot = skipSpaces(expr, i + 1);
      if (expr[dot] === '.') {
        const ref = readPath(expr, dot, ['@'], i, offset, refs);
        refs.push({ ...ref.reference, current: true });
        i = ref.end;
        afterValue = true;
        continue;
      }
      if (next && /[A-Za-z]/.test(next)) {
        // Label id: `@SYS12345`, `@GER_LABEL:Name`, `@Module:Label`.
        let j = i + 1;
        while (j < expr.length && /[\w:.-]/.test(expr[j])) j++;
        i = j;
        afterValue = true;
        continue;
      }
      i++;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      while (i < expr.length && /[0-9.eE]/.test(expr[i])) i++;
      afterValue = true;
      continue;
    }

    if (ch === '.') {
      // Field access on an unnamed value: skip the field name.
      const j = skipSpaces(expr, i + 1);
      const name = readName(expr, j);
      i = name ? name.end : i + 1;
      continue;
    }

    const name = readName(expr, i);
    if (name) {
      const after = skipSpaces(expr, name.end);
      if (expr[after] === '(' && expr[i] !== "'") {
        // A function call: its name is not data, its arguments are searched.
        i = name.end;
        afterValue = false;
        continue;
      }
      if (afterValue && expr[i - 1] === '.') { i = name.end; continue; }
      if (expr[i] !== "'" && KEYWORDS.has(name.name.toLowerCase()) && expr[after] !== '.') {
        i = name.end;
        afterValue = false;
        continue;
      }
      const ref = readPath(expr, name.end, [name.name], i, offset, refs);
      refs.push(ref.reference);
      i = ref.end;
      afterValue = true;
      continue;
    }

    if (ch === ')' || ch === ']') afterValue = true;
    else afterValue = false;
    i++;
  }
  return refs;
}

/**
 * Continues a path whose first segment ended at `i`. Method calls keep their
 * `()` and the references in their arguments are pushed to `nested`.
 */
function readPath(
  expr: string,
  i: number,
  segments: string[],
  start: number,
  offset: number,
  nested: ExpressionReference[],
): { reference: ExpressionReference; end: number } {
  let end = i;
  let j = skipSpaces(expr, i);
  while (expr[j] === '.') {
    const nameAt = skipSpaces(expr, j + 1);
    const name = readName(expr, nameAt);
    if (!name) break;
    let segment = name.name;
    end = name.end;
    const after = skipSpaces(expr, name.end);
    if (expr[after] === '(') {
      const close = matchingParen(expr, after);
      const args = expr.slice(after + 1, Math.max(after + 1, close - 1));
      nested.push(...extractReferences(args, offset + after + 1));
      segment = `${segment}()`;
      end = close;
    }
    segments.push(segment);
    j = skipSpaces(expr, end);
  }
  return { reference: { segments, current: false, start: offset + start, end: offset + end }, end };
}

export interface FunctionCall {
  name: string;
  /** Top-level arguments, trimmed. */
  args: string[];
}

/**
 * `NAME(arg, …)` when the whole expression is one function call, else `null`.
 * Arguments are split on top-level commas only.
 */
export function parseFunctionCall(expr: string): FunctionCall | null {
  const trimmed = expr.trim();
  const match = /^([A-Za-z_][\w]*)\s*\(/.exec(trimmed);
  if (!match) return null;
  const open = match[0].length - 1;
  const close = matchingParen(trimmed, open);
  if (close !== trimmed.length) return null;
  const inner = trimmed.slice(open + 1, close - 1);
  const args: string[] = [];
  let depth = 0;
  let last = 0;
  for (let j = 0; j < inner.length; j++) {
    const ch = inner[j];
    if (ch === '"' || ch === "'") { j = quotedEnd(inner, j) - 1; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(inner.slice(last, j).trim());
      last = j + 1;
    }
  }
  const tail = inner.slice(last).trim();
  if (tail || args.length > 0) args.push(tail);
  return { name: match[1].toUpperCase(), args };
}

/**
 * Functions whose result is (a part of) the list in their first argument —
 * the record a field read on the result comes from is that list's record.
 * The other arguments only select or order.
 */
export const LIST_PRESERVING_FUNCTIONS = new Set([
  'WHERE', 'FILTER', 'ORDERBY', 'REVERSE', 'FIRSTORNULL', 'FIRST', 'ALLITEMS', 'ALLITEMSQUERY',
]);

/** Functions that return a single record of the list they get. */
export const RECORD_FUNCTIONS = new Set(['FIRSTORNULL', 'FIRST']);

/** Functions that return a list. */
export const LIST_FUNCTIONS = new Set([
  'WHERE', 'FILTER', 'ORDERBY', 'REVERSE', 'ALLITEMS', 'ALLITEMSQUERY', 'ENUMERATE', 'SPLIT',
  'SPLITLIST', 'SPLITLISTBYLIMIT', 'LIST', 'LISTOFFIELDS', 'EMPTYLIST', 'UNION', 'GROUPBY',
]);

/** A literal value: a string, a label, a number or a boolean. */
export function constantValue(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  const str = /^"((?:[^"]|"")*)"$/.exec(trimmed);
  if (str) return str[1].replace(/""/g, '"');
  if (/^@"[^"]*"$/.test(trimmed)) return trimmed;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

/** A bare path and nothing else (`model.Invoice.Id`, `'$X'.Y`, `@.Qty`). */
export function isBarePath(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  const refs = extractReferences(trimmed);
  if (refs.length !== 1) return false;
  const [ref] = refs;
  return ref.start === 0 && ref.end === trimmed.length && !ref.segments.some(s => s.endsWith('()'));
}

/**
 * `expr` with every current-record `@` replaced by `current` — the bare path
 * of the list the element iterates — so `@.ItemId` inside a lines element
 * reads `model.InvoiceBase.Lines.ItemId`, which resolves on its own.
 */
export function substituteCurrent(expr: string, current: string): string {
  const refs = extractReferences(expr).filter(ref => ref.current);
  let out = expr;
  for (const ref of refs.reverse()) {
    out = out.slice(0, ref.start) + current + out.slice(ref.start + 1);
  }
  return out;
}
