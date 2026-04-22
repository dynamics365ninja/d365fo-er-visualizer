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
  const id = trimmed.replace(/^@/, '').replace(/^"(.*)"$/, '$1').trim();
  const raw = trimmed;
  if (!id) return { id: '', raw };
  if (!labels || labels.length === 0) return { id, raw };

  const pool = labels.filter(l => l.labelId === id);
  if (pool.length === 0) return { id, raw };

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
