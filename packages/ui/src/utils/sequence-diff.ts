/**
 * Two sequences lined up item against item: the longest run of equal items
 * pairs up, and inside each stretch between two such pairs the items left
 * over pair up when they are alike enough (a changed line, a row whose cell
 * was edited) or stay removed / added. Shared by the line view of two preview
 * documents and the row alignment of two template sheets.
 */

export type AlignedPair =
  | { kind: 'same'; a: number; b: number }
  | { kind: 'changed'; a: number; b: number }
  | { kind: 'removed'; a: number }
  | { kind: 'added'; b: number };

/** Largest LCS table built for the middle of two sequences (n × m cells). */
const MAX_LCS_CELLS = 4_000_000;
/** Largest stretch (removed × added) aligned by similarity; beyond it items pair in order. */
const MAX_HUNK_CELLS = 40_000;

type Op = { kind: 'same'; a: number; b: number } | { kind: 'removed'; a: number } | { kind: 'added'; b: number };

/** Equal keys paired along the longest common subsequence; the rest removed or added. */
function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: 'same', a: i, b: i });

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_LCS_CELLS) {
    const width = m + 1;
    const table = new Int32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        ops.push({ kind: 'same', a: start + i, b: start + j });
        i++; j++;
      } else if (j >= m || (i < n && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
        ops.push({ kind: 'removed', a: start + i++ });
      } else {
        ops.push({ kind: 'added', b: start + j++ });
      }
    }
  } else {
    // Too long to line up: everything in the middle was replaced.
    for (let i = start; i < endA; i++) ops.push({ kind: 'removed', a: i });
    for (let j = start; j < endB; j++) ops.push({ kind: 'added', b: j });
  }

  for (let k = 0; k < a.length - endA; k++) ops.push({ kind: 'same', a: endA + k, b: endB + k });
  return ops;
}

/**
 * The removed and added items of one stretch, paired where alike: the
 * monotonic pairing with the highest total similarity, a pair only when the
 * two are at least `threshold` alike. Without a similarity they pair in order.
 */
function alignHunk(
  removed: number[],
  added: number[],
  similarity: ((a: number, b: number) => number) | undefined,
  threshold: number,
): AlignedPair[] {
  const out: AlignedPair[] = [];
  // As many items came as went: each was edited in place, as a side-by-side
  // diff shows it. Otherwise similarity tells the edited ones from the new.
  if (!similarity || removed.length === added.length || removed.length * added.length > MAX_HUNK_CELLS) {
    const paired = !similarity || removed.length === added.length ? Math.min(removed.length, added.length) : 0;
    for (let k = 0; k < paired; k++) out.push({ kind: 'changed', a: removed[k], b: added[k] });
    for (let k = paired; k < removed.length; k++) out.push({ kind: 'removed', a: removed[k] });
    for (let k = paired; k < added.length; k++) out.push({ kind: 'added', b: added[k] });
    return out;
  }
  const n = removed.length;
  const m = added.length;
  const width = m + 1;
  const score = new Float64Array((n + 1) * width);
  const sim = new Float64Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) sim[i * m + j] = similarity(removed[i], added[j]);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = sim[i * m + j];
      const pair = s >= threshold ? s + score[(i + 1) * width + j + 1] : -1;
      score[i * width + j] = Math.max(pair, score[(i + 1) * width + j], score[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m) {
      const s = sim[i * m + j];
      if (s >= threshold && s + score[(i + 1) * width + j + 1] >= score[i * width + j] - 1e-9) {
        out.push({ kind: 'changed', a: removed[i++], b: added[j++] });
        continue;
      }
    }
    if (j >= m || (i < n && score[(i + 1) * width + j] >= score[i * width + j + 1])) out.push({ kind: 'removed', a: removed[i++] });
    else out.push({ kind: 'added', b: added[j++] });
  }
  return out;
}

/**
 * Line up two sequences by their keys. `similarity` (0 – 1) decides which of
 * the items left between two equal ones are the same item changed; without
 * it they pair in order, the surplus removed or added.
 */
export function alignSequences(
  a: readonly string[],
  b: readonly string[],
  options: { similarity?: (a: number, b: number) => number; threshold?: number } = {},
): AlignedPair[] {
  const ops = lcsOps(a, b);
  const out: AlignedPair[] = [];
  let removed: number[] = [];
  let added: number[] = [];
  const flush = () => {
    if (removed.length > 0 || added.length > 0) out.push(...alignHunk(removed, added, options.similarity, options.threshold ?? 0.5));
    removed = [];
    added = [];
  };
  for (const op of ops) {
    if (op.kind === 'same') {
      flush();
      out.push(op);
    } else if (op.kind === 'removed') {
      removed.push(op.a);
    } else {
      added.push(op.b);
    }
  }
  flush();
  return out;
}

/** How alike two texts are: the share of the longer one their common start and end cover. */
export function textSimilarity(x: string, y: string): number {
  if (x === y) return 1;
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  const max = Math.min(x.length, y.length);
  let start = 0;
  while (start < max && x[start] === y[start]) start++;
  let end = 0;
  while (end < max - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  return (start + end) / longest;
}

export type FoldItem<R> =
  | { kind: 'row'; row: R }
  | { kind: 'fold'; rows: R[] };

/**
 * Unchanged runs longer than the context around a change fold into one row:
 * a 60-line formula with one changed argument shows that argument, not a
 * wall of identical lines.
 */
export function foldUnchanged<R extends { kind: string }>(rows: readonly R[], context: number): Array<FoldItem<R>> {
  const items: Array<FoldItem<R>> = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'same') {
      items.push({ kind: 'row', row: rows[i++] });
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end].kind === 'same') end++;
    const run = rows.slice(i, end);
    const keepHead = i === 0 ? 0 : context;
    const keepTail = end === rows.length ? 0 : context;
    // Folding fewer lines than this saves nothing worth a click.
    if (run.length - keepHead - keepTail >= 3) {
      run.slice(0, keepHead).forEach(row => items.push({ kind: 'row', row }));
      items.push({ kind: 'fold', rows: run.slice(keepHead, run.length - keepTail) });
      run.slice(run.length - keepTail).forEach(row => items.push({ kind: 'row', row }));
    } else {
      run.forEach(row => items.push({ kind: 'row', row }));
    }
    i = end;
  }
  return items;
}
