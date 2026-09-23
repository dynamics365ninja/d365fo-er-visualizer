/**
 * How well a search hit matches the query, higher first. The registry search
 * is a plain substring filter in file order, so an exact `TaxTrans` could sit
 * below `TaxTransOrigin…` or past the cut-off. Names beat paths, and both beat
 * a match that is only inside an expression.
 */
export function searchRelevance(
  hit: { target: string; sourceComponent: string; sourceContext: string },
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  return Math.max(nameScore(hit.target, q), nameScore(hit.sourceComponent, q), contextScore(hit.sourceContext, q));
}

function nameScore(value: string, q: string): number {
  if (!value) return 0;
  const full = value.toLowerCase();
  const leaf = lastSegment(full);
  if (leaf === q) return 100;
  if (full === q) return 95;
  if (leaf.startsWith(q)) return 80;
  if (wordStarts(lastSegment(value)).some(start => leaf.startsWith(q, start))) return 65;
  if (leaf.includes(q)) return 50;
  if (full.includes(q)) return 30;
  return 0;
}

function contextScore(value: string, q: string): number {
  return value && value.toLowerCase().includes(q) ? 10 : 0;
}

/** The last part of a path like `model.Invoice.'$Date'` or `Invoice/Lines/Amount`. */
function lastSegment(value: string): string {
  const parts = value.split(/[./\\]/).filter(Boolean);
  return (parts[parts.length - 1] ?? value).replace(/^['"$@#]+|['"]+$/g, '');
}

/** Offsets where a word starts inside a name: after `_`, `-`, a space, or at a camelCase hump. */
function wordStarts(name: string): number[] {
  const clean = name.replace(/^['"$@#]+|['"]+$/g, '');
  const starts: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const ch = clean[i];
    if (/[_\-\s]/.test(prev) || (/[a-z0-9]/.test(prev) && /[A-Z]/.test(ch))) starts.push(i);
  }
  return starts;
}

/** Stable sort by relevance; ties keep their original (file) order. */
export function rankByRelevance<T extends { target: string; sourceComponent: string; sourceContext: string }>(
  hits: T[],
  query: string,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  return hits
    .map((hit, index) => ({ hit, index, score: searchRelevance(hit, query) }))
    .sort((a, b) => (tieBreak?.(a.hit, b.hit) ?? 0) || b.score - a.score || a.index - b.index)
    .map(entry => entry.hit);
}
