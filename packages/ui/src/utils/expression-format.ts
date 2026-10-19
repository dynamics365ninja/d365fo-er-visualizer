/**
 * ER formulas laid out on indented lines, and two formulas compared line by
 * line. A long `IF(…, CASE(…), WHERE(…))` read as one wrapped line hides
 * which argument changed; one argument per line puts the change on a line of
 * its own.
 *
 * Lines break only right after `(` or `,` and right before `)`. A reference
 * never spans those, so every line tokenizes on its own exactly as it does
 * inside the whole formula, and can be rendered (coloured, clickable) by
 * itself.
 */
import { inlineChange, type InlineChange } from './version-diff';

export interface FormulaLine {
  /** Nesting depth: how many argument lists the line sits in. */
  indent: number;
  text: string;
}

/** A formula longer than this is laid out on several lines. */
export const FORMULA_WIDTH = 60;
/** A call whose arguments take no more than this stays on one line inside a broken one. */
const INLINE_CALL_WIDTH = 28;

type Piece = string | Group;
interface Group {
  args: Piece[][];
}

/** String literals (`""` escapes a quote), quoted names, parentheses, commas, whitespace, the rest. */
const TOKENS = /"(?:[^"]|"")*"?|'[^']*'?|[(),]|\s+|[^"'(),\s]+/g;

/**
 * The formula's pieces: text, and parenthesised groups split into their
 * arguments. Whitespace outside literals collapses to one space and is
 * dropped next to parentheses and commas, so the same formula typed with
 * different spacing or line breaks lays out the same.
 */
function parse(expr: string): Piece[] {
  const root: Piece[] = [];
  const stack: Array<{ group: Group; arg: Piece[]; outer: Piece[] }> = [];
  let seq = root;

  const pushText = (text: string) => {
    const last = seq[seq.length - 1];
    if (typeof last === 'string') seq[seq.length - 1] = last + text;
    else seq.push(text);
  };

  for (const token of expr.match(TOKENS) ?? []) {
    if (token === '(') {
      // A space before the parenthesis stays: `AND (a OR b)` is no call.
      const group: Group = { args: [] };
      seq.push(group);
      stack.push({ group, arg: [], outer: seq });
      seq = stack[stack.length - 1].arg;
    } else if (token === ',' && stack.length > 0) {
      const top = stack[stack.length - 1];
      trimEnd(seq);
      top.group.args.push(seq);
      top.arg = [];
      seq = top.arg;
    } else if (token === ')' && stack.length > 0) {
      const top = stack.pop()!;
      trimEnd(seq);
      if (seq.length > 0 || top.group.args.length > 0) top.group.args.push(seq);
      seq = top.outer;
    } else if (/^\s+$/.test(token)) {
      // Leading space of an argument, space after an opening parenthesis: dropped.
      if (seq.length > 0) pushText(' ');
    } else {
      pushText(token);
    }
  }
  // An unbalanced formula closes what it opened, so nothing is lost.
  while (stack.length > 0) {
    const top = stack.pop()!;
    trimEnd(seq);
    if (seq.length > 0 || top.group.args.length > 0) top.group.args.push(seq);
    seq = top.outer;
  }
  trimEnd(root);
  return root;
}

function trimEnd(seq: Piece[]): void {
  const last = seq[seq.length - 1];
  if (typeof last !== 'string') return;
  const trimmed = last.replace(/\s+$/, '');
  if (trimmed) seq[seq.length - 1] = trimmed;
  else seq.pop();
}

function flat(seq: readonly Piece[]): string {
  return seq.map(piece => (typeof piece === 'string' ? piece : `(${piece.args.map(flat).join(', ')})`)).join('');
}

function layout(seq: readonly Piece[], indent: number, width: number, out: FormulaLine[]): void {
  const whole = flat(seq);
  if (whole.length + indent * 2 <= width || !seq.some(piece => typeof piece !== 'string')) {
    out.push({ indent, text: whole });
    return;
  }
  let line = '';
  for (const piece of seq) {
    if (typeof piece === 'string') {
      line += piece;
      continue;
    }
    const inline = `(${piece.args.map(flat).join(', ')})`;
    if (inline.length <= INLINE_CALL_WIDTH || piece.args.length === 0) {
      line += inline;
      continue;
    }
    out.push({ indent, text: `${line}(` });
    piece.args.forEach((arg, i) => {
      const start = out.length;
      layout(arg, indent + 1, width, out);
      if (i < piece.args.length - 1) {
        const last = out.length - 1;
        if (last >= start) out[last] = { ...out[last], text: `${out[last].text},` };
      }
    });
    line = ')';
  }
  if (line) out.push({ indent, text: line });
}

/** The formula on one line when it fits in `width`, otherwise one argument per line. */
export function formatFormula(expr: string, width = FORMULA_WIDTH): FormulaLine[] {
  const pieces = parse(expr ?? '');
  if (pieces.length === 0) return [{ indent: 0, text: '' }];
  const out: FormulaLine[] = [];
  layout(pieces, 0, width, out);
  return out;
}

export type FormulaRowKind = 'same' | 'changed' | 'removed' | 'added';

export interface FormulaRow {
  kind: FormulaRowKind;
  before?: FormulaLine;
  after?: FormulaLine;
  /** For a changed row, the part of the line that differs on each side. */
  change?: InlineChange;
}

/**
 * Two formulas side by side, line against line: the lines both have (the
 * longest common run, compared without indentation) face each other, the
 * ones in between pair up as changed while both sides have some left, the
 * rest are removed or added.
 */
export function diffFormulaLines(before: readonly FormulaLine[], after: readonly FormulaLine[]): FormulaRow[] {
  const n = before.length;
  const m = after.length;
  const same = (i: number, j: number) => before[i].text === after[j].text;
  // Longest common subsequence, filled from the end.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: FormulaRow[] = [];
  let removed: FormulaLine[] = [];
  let added: FormulaLine[] = [];
  const flush = () => {
    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++) {
      rows.push({ kind: 'changed', before: removed[k], after: added[k], change: inlineChange(removed[k].text, added[k].text) });
    }
    for (const line of removed.slice(paired)) rows.push({ kind: 'removed', before: line });
    for (const line of added.slice(paired)) rows.push({ kind: 'added', after: line });
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && same(i, j)) {
      flush();
      rows.push({ kind: before[i].indent === after[j].indent ? 'same' : 'changed', before: before[i], after: after[j] });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push(after[j++]);
    } else {
      removed.push(before[i++]);
    }
  }
  flush();
  return rows;
}
