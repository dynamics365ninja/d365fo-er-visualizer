import type { ERLabel } from '@er-visualizer/core';

export interface ResolvedLabel {
  /** Normalised label id (without @ prefix or surrounding quotes). */
  id: string;
  /** Original raw reference (what the model stored). */
  raw: string;
  /** en-us translation, if available. */
  enUs?: string;
  /** User-locale translation, if available and different from en-us. */
  localized?: string;
  /** LanguageId of the localized translation (as stored in XML). */
  localizedLang?: string;
}

function normalizeLang(lang: string): string {
  return lang.toLowerCase();
}

/** Detects the preferred user language tag (lower-cased, e.g. "cs-cz", "en-us"). */
export function getUserLanguageTag(): string {
  if (typeof navigator === 'undefined') return 'en-us';
  return normalizeLang(navigator.language || 'en-us');
}

/**
 * Resolves a label reference (e.g. `@"_MyLabel"`, `@Foo`, or plain `Foo`) against
 * the label table of an ERSolution. Returns the en-us translation plus the user's
 * locale translation, when available.
 */
export function resolveLabel(
  labelRef: string | null | undefined,
  labels: ERLabel[] | undefined,
  userLang: string = getUserLanguageTag(),
): ResolvedLabel | null {
  if (!labelRef) return null;
  const trimmed = String(labelRef).trim();
  if (!trimmed) return null;

  // Strip common reference decorations: leading '@' and surrounding quotes.
  const bare = trimmed
    .replace(/^@/, '')
    .replace(/^"(.*)"$/, '$1')
    .trim();
  // D365 ER writes references as `@"GER_LABEL:Foo"`, but the label table stores
  // the id either with or without that prefix depending on the export path.
  const stripped = bare.replace(/^GER_LABEL:/, '').trim();
  const raw = trimmed;
  if (!bare) return { id: '', raw };
  if (!labels || labels.length === 0) return { id: stripped, raw };

  let id = bare;
  let pool = labels.filter(l => l.labelId === bare);
  if (pool.length === 0 && stripped !== bare) {
    id = stripped;
    pool = labels.filter(l => l.labelId === stripped);
  }
  if (pool.length === 0) return { id: stripped, raw };

  const findByLang = (lang: string) =>
    pool.find(l => normalizeLang(l.languageId) === lang);

  const enUs = findByLang('en-us') ?? findByLang('en') ?? findByLang('en-gb');

  const lang = normalizeLang(userLang);
  let localized = findByLang(lang);
  if (!localized && lang.includes('-')) {
    const primary = lang.split('-')[0];
    localized = findByLang(primary)
      ?? pool.find(l => normalizeLang(l.languageId).startsWith(primary + '-'));
  } else if (!localized && !lang.includes('-')) {
    localized = pool.find(l => normalizeLang(l.languageId).startsWith(lang + '-'));
  }

  const sameAsEnUs = localized && enUs && localized.languageId === enUs.languageId;

  return {
    id,
    raw,
    enUs: enUs?.labelValue,
    localized: sameAsEnUs ? undefined : localized?.labelValue,
    localizedLang: sameAsEnUs ? undefined : localized?.languageId,
  };
}

interface LabelBearingConfiguration {
  solutionVersion?: { solution?: { labels?: ERLabel[] } };
}

/** Cached per configurations array — the format tree resolves labels row by row. */
const labelPoolCache = new WeakMap<object, Map<number, ERLabel[]>>();

/**
 * Label texts a configuration can resolve: its own table first, then every other
 * loaded configuration. A format or mapping references labels whose definition
 * lives in the data model solution, so resolving against one file alone leaves
 * the raw `@GER_...` id on screen.
 */
export function buildLabelPool(
  configurations: readonly LabelBearingConfiguration[] | undefined,
  configIndex: number,
): ERLabel[] {
  if (!configurations || configurations.length === 0) return [];

  const cached = labelPoolCache.get(configurations);
  const hit = cached?.get(configIndex);
  if (hit) return hit;

  const own = configurations[configIndex]?.solutionVersion?.solution?.labels ?? [];
  const others: ERLabel[] = [];
  configurations.forEach((cfg, index) => {
    if (index === configIndex) return;
    const labels = cfg?.solutionVersion?.solution?.labels;
    if (labels?.length) others.push(...labels);
  });
  const pool = others.length > 0 ? [...own, ...others] : own;

  const byIndex = cached ?? new Map<number, ERLabel[]>();
  byIndex.set(configIndex, pool);
  labelPoolCache.set(configurations, byIndex);
  return pool;
}

