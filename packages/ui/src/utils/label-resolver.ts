import type { ERLabel } from '@er-visualizer/core';
import { getLocale } from '../i18n';

export interface ResolvedLabel {
  /** Normalised label id (without @ prefix, quotes or the `GER_LABEL:` module prefix). */
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

/** Preferred language for label texts — the app's language switch, not the browser's. */
export function getUserLanguageTag(): string {
  return getLocale() === 'cs' ? 'cs' : 'en-us';
}

/**
 * Strips reference decorations from a label reference and returns the bare
 * id plus a "core" id with any `MODULE:` prefix (e.g. `GER_LABEL:`) removed.
 *
 * Accepted input shapes (all seen in real ER exports):
 *   `@"GER_LABEL:Foo"`, `@GER_LABEL:Foo`, `"GER_LABEL:Foo"`, `GER_LABEL:Foo`,
 *   `@"Foo"`, `@Foo`, `Foo`, `@GER_LABEL_1`
 */
export function normalizeLabelRef(ref: string): { bare: string; core: string } {
  const bare = ref
    .trim()
    .replace(/^@/, '')
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^'(.*)'$/s, '$1')
    .trim();
  const core = bare.replace(/^[A-Za-z][A-Za-z0-9_]*:/, '').trim();
  return { bare, core };
}

/** Lower-cased, prefix-less key used to compare label ids across export paths. */
function labelKey(id: string): string {
  return normalizeLabelRef(id).core.toLowerCase();
}

/** True when the value looks like a label reference rather than literal text. */
export function looksLikeLabelRef(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  return v.startsWith('@') || /^"?[A-Za-z][A-Za-z0-9_]*:[^"\s]+"?$/.test(v);
}

/** Cached per label array — the same table is queried for every row in a tree. */
const labelIndexCache = new WeakMap<ERLabel[], Map<string, ERLabel[]>>();

function indexLabels(labels: ERLabel[]): Map<string, ERLabel[]> {
  const cached = labelIndexCache.get(labels);
  if (cached) return cached;
  const index = new Map<string, ERLabel[]>();
  for (const label of labels) {
    if (!label.labelId) continue;
    const key = labelKey(label.labelId);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(label);
    else index.set(key, [label]);
  }
  labelIndexCache.set(labels, index);
  return index;
}

/**
 * Resolves a label reference (e.g. `@"GER_LABEL:Foo"`, `@GER_LABEL:Foo`, `@Foo`
 * or plain `Foo`) against the label table of an ERSolution. Returns the en-us
 * translation plus the user's locale translation, when available.
 *
 * Matching is tolerant on purpose: ids are compared case-insensitively and
 * without the module prefix (`GER_LABEL:`), because F&O writes the prefix into
 * the reference but different export paths store the table id either with or
 * without it.
 */
export function resolveLabel(
  labelRef: string | null | undefined,
  labels: ERLabel[] | undefined,
  userLang: string = getUserLanguageTag(),
): ResolvedLabel | null {
  if (!labelRef) return null;
  const trimmed = String(labelRef).trim();
  if (!trimmed) return null;

  const { bare, core } = normalizeLabelRef(trimmed);
  const raw = trimmed;
  if (!bare) return { id: '', raw };
  if (!labels || labels.length === 0) return { id: core, raw };

  const index = indexLabels(labels);
  // Exact (case-sensitive) match on the bare id wins when several ids collapse
  // to the same key; otherwise fall back to the tolerant bucket.
  const bucket = index.get(core.toLowerCase()) ?? [];
  let pool = bucket.filter(l => l.labelId === bare || l.labelId === core);
  if (pool.length === 0) pool = bucket;
  if (pool.length === 0) return { id: core, raw };

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

  // Last resort: any translation at all is better than the raw id.
  const anyText = enUs ?? localized ?? pool.find(l => l.labelValue);
  const effectiveEnUs = enUs ?? (localized ? undefined : anyText);

  const sameAsEnUs = localized && effectiveEnUs && localized.languageId === effectiveEnUs.languageId;

  return {
    id: core,
    raw,
    enUs: effectiveEnUs?.labelValue,
    localized: sameAsEnUs ? undefined : localized?.labelValue,
    localizedLang: sameAsEnUs ? undefined : localized?.languageId,
  };
}

/**
 * Best human-readable text for a label reference: the user's locale first,
 * then en-us, then the bare id. Returns `undefined` when `labelRef` is empty.
 */
export function labelDisplayText(
  labelRef: string | null | undefined,
  labels: ERLabel[] | undefined,
  userLang?: string,
): string | undefined {
  const resolved = resolveLabel(labelRef, labels, userLang);
  if (!resolved) return undefined;
  return resolved.localized ?? resolved.enUs ?? resolved.id ?? resolved.raw;
}

/** True when the reference resolved to at least one translation. */
export function isLabelResolved(resolved: ResolvedLabel | null | undefined): boolean {
  return Boolean(resolved && (resolved.enUs || resolved.localized));
}

interface LabelBearingConfiguration {
  solutionVersion?: { solution?: { labels?: ERLabel[] } };
}

/** Cached per configurations array — the format tree resolves labels row by row. */
let labelPoolCache = new WeakMap<object, Map<number, ERLabel[]>>();

/**
 * Labels harvested from F&O responses that are NOT loaded as configurations
 * (scout/probe downloads, ancestor models). Only the format response ships the
 * dictionary, so every response is a potential source. Lowest priority in the
 * pool — a configuration's own table always wins.
 */
const harvestedLabels: ERLabel[] = [];
const harvestedKeys = new Set<string>();

/** Adds labels to the shared pool; returns how many were new. */
export function registerHarvestedLabels(labels: readonly ERLabel[]): number {
  let added = 0;
  for (const l of labels) {
    if (!l.labelId) continue;
    const key = `${l.labelId}\u0000${l.languageId}`;
    if (harvestedKeys.has(key)) continue;
    harvestedKeys.add(key);
    harvestedLabels.push(l);
    added += 1;
  }
  // Pools built before this call are stale.
  if (added > 0) labelPoolCache = new WeakMap();
  return added;
}

/**
 * Label texts a configuration can resolve: its own table first, then every other
 * loaded configuration. Only the format response carries the dictionary, so a
 * data model resolved against its own table alone shows raw `@GER_...` ids.
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
  const pool = others.length > 0 || harvestedLabels.length > 0
    ? [...own, ...others, ...harvestedLabels]
    : own;

  const byIndex = cached ?? new Map<number, ERLabel[]>();
  byIndex.set(configIndex, pool);
  labelPoolCache.set(configurations, byIndex);
  return pool;
}
