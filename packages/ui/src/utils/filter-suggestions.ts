/**
 * Type-ahead for the filter fields.
 *
 * The filter boxes are plain substring searches, which is fine once you know
 * what lives in a configuration and useless before that: a mapping holds a few
 * hundred bindings and data sources whose names are the only way in. These
 * helpers turn whatever a panel is showing into a ranked list of terms that
 * actually match something, so the field can propose them instead of leaving
 * the user to guess.
 */

export interface FilterSuggestion {
  /** Text put into the filter when the row is chosen. */
  value: string;
  /** List the term came from; doubles as the dropdown's group heading. */
  group: string;
  /** How many rows carry the term. */
  count: number;
  /** View to switch to so the filtered rows are actually on screen. */
  view?: string;
}

/**
 * Tally terms, keeping the first spelling seen.
 *
 * Names differing only in case are the same term to a case-insensitive filter,
 * and offering both spellings as separate rows would just waste the list.
 */
export function countTerms(terms: Iterable<string | undefined | null>): Map<string, number> {
  const counts = new Map<string, number>();
  const spelling = new Map<string, string>();

  for (const raw of terms) {
    const term = (raw ?? '').trim();
    if (term.length < 2) continue;
    const key = term.toLowerCase();
    if (!spelling.has(key)) spelling.set(key, term);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out = new Map<string, number>();
  for (const [key, count] of counts) out.set(spelling.get(key)!, count);
  return out;
}

/** Wrap a tally as suggestions belonging to one group / view. */
export function suggestionsFromCounts(
  counts: Map<string, number>,
  group: string,
  view?: string,
): FilterSuggestion[] {
  const out: FilterSuggestion[] = [];
  for (const [value, count] of counts) out.push({ value, group, count, view });
  return out;
}

/**
 * How well `value` answers `query`: lower is better, `null` means no match.
 * A term the query already spells out in full is dropped — there is nothing
 * left to complete, and it would push a useful row off the list.
 */
function matchScore(value: string, query: string): number | null {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();
  const at = haystack.indexOf(needle);
  if (at < 0) return null;
  if (haystack === needle) return null;
  if (at === 0) return 0;
  // A hit right after a separator reads as "the start of a name" too. `$`
  // counts: ER prefixes calculated fields and parameters with it, so
  // `$TaxAmount` is a name starting in Tax as far as the user is concerned.
  const before = haystack[at - 1];
  if ('/._- $'.includes(before)) return 1;
  return 2;
}

export interface RankOptions {
  /** Rows kept per group. */
  perGroup?: number;
  /** Rows kept overall. */
  total?: number;
}

/**
 * The suggestions worth showing for `query`, grouped in the order the groups
 * first appear in `pool`.
 *
 * Ranked by how early the query lands in the term, then by how many rows carry
 * it — a name shared by forty bindings is a more useful filter than a one-off,
 * and a shorter term beats a longer one that merely contains it.
 */
export function rankSuggestions(
  pool: FilterSuggestion[],
  query: string,
  options: RankOptions = {},
): FilterSuggestion[] {
  const needle = query.trim();
  if (needle.length === 0) return [];

  const perGroup = options.perGroup ?? 6;
  const total = options.total ?? 12;

  const groupOrder = new Map<string, number>();
  const scored: Array<{ suggestion: FilterSuggestion; score: number }> = [];

  for (const suggestion of pool) {
    if (!groupOrder.has(suggestion.group)) groupOrder.set(suggestion.group, groupOrder.size);
    const score = matchScore(suggestion.value, needle);
    if (score == null) continue;
    scored.push({ suggestion, score });
  }

  scored.sort((left, right) => {
    const byGroup = (groupOrder.get(left.suggestion.group) ?? 0) - (groupOrder.get(right.suggestion.group) ?? 0);
    if (byGroup !== 0) return byGroup;
    if (left.score !== right.score) return left.score - right.score;
    if (left.suggestion.count !== right.suggestion.count) return right.suggestion.count - left.suggestion.count;
    if (left.suggestion.value.length !== right.suggestion.value.length) {
      return left.suggestion.value.length - right.suggestion.value.length;
    }
    return left.suggestion.value.localeCompare(right.suggestion.value);
  });

  const kept: FilterSuggestion[] = [];
  const perGroupCount = new Map<string, number>();
  for (const { suggestion } of scored) {
    if (kept.length >= total) break;
    const used = perGroupCount.get(suggestion.group) ?? 0;
    if (used >= perGroup) continue;
    perGroupCount.set(suggestion.group, used + 1);
    kept.push(suggestion);
  }
  return kept;
}

// ─── Recent filters ──────────────────────────────────────────────────────────

const HISTORY_PREFIX = 'er-visualizer.filter-history.';
const HISTORY_LIMIT = 6;
/** One-character filters say nothing about what the user was looking for. */
const HISTORY_MIN_LENGTH = 2;

function historyKey(scope: string): string {
  return `${HISTORY_PREFIX}${scope}`;
}

export function loadFilterHistory(scope: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(historyKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** Most recent first, deduplicated case-insensitively. Returns the new list. */
export function pushFilterHistory(scope: string, value: string): string[] {
  const entry = value.trim();
  if (entry.length < HISTORY_MIN_LENGTH) return loadFilterHistory(scope);

  const key = entry.toLowerCase();
  const next = [entry, ...loadFilterHistory(scope).filter(item => item.toLowerCase() !== key)]
    .slice(0, HISTORY_LIMIT);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(historyKey(scope), JSON.stringify(next));
    } catch {
      // A blocked or full storage costs the user their history, nothing more.
    }
  }
  return next;
}

/** Split a highlighted term into the part before, the match and the rest. */
export function splitHighlight(value: string, query: string): [string, string, string] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [value, '', ''];
  const at = value.toLowerCase().indexOf(needle);
  if (at < 0) return [value, '', ''];
  return [value.slice(0, at), value.slice(at, at + needle.length), value.slice(at + needle.length)];
}
