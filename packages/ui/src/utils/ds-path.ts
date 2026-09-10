/**
 * Datasource paths written as ER expressions.
 *
 * A group-by datasource points at the list it groups with a slash path —
 * `Control statement/$A1Trans` — while everything that resolves references
 * (the tokenizer, `parseDottedPath`, the drill-down tree) speaks expressions.
 * Swapping the slashes for dots is not enough: a path segment is a *name* and
 * may hold spaces and `$` prefixes, which an expression reader takes as
 * separate tokens. `Control statement` came back as two unresolved references,
 * `Control` and `statement`, and the group-by's real source was never found.
 */

/** Segments an ER expression can carry unquoted. */
const BARE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One path segment as an expression token, quoted only when it has to be. */
export function quotePathSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1) return trimmed;
  return BARE_SEGMENT.test(trimmed) ? trimmed : `'${trimmed}'`;
}

/**
 * `Control statement/$A1Trans` → `'Control statement'.'$A1Trans'`.
 * Already-dotted input is passed through segment by segment as well, so a
 * caller does not have to know which of the two spellings it holds.
 */
export function dsPathToExpression(path: string): string {
  return String(path ?? '')
    .split('/')
    .flatMap(part => (part.includes("'") ? [part] : part.split('.')))
    .map(quotePathSegment)
    .filter(Boolean)
    .join('.');
}
