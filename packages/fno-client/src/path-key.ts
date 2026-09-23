/**
 * Synthetic path generators for F&O-sourced configurations.
 *
 * These strings live in `ERConfiguration.filePath` and are used as:
 *   - the unique identifier inside `state.configurations`,
 *   - the cache key in IndexedDB,
 *   - the ingredient for `RecentSession` fingerprints.
 *
 * Keeping the `fno://` scheme guarantees the key cannot collide with
 * local file names (which are bare basenames like `MyConfig.xml`).
 */

export interface BuildFnoPathInput {
  envUrl: string;
  solutionName: string;
  configurationName: string;
  version?: string;
  componentType?: string;
}

/**
 * Build a stable path key for an F&O-sourced configuration.
 *
 * Example:
 *   envUrl           = "https://org1.sandbox.operations.dynamics.com"
 *   solutionName     = "TaxReport"
 *   configurationName= "Intrastat model mapping"
 *   version          = "252"
 *
 *   ⇒ "fno://org1.sandbox.operations.dynamics.com/TaxReport/Intrastat-model-mapping@252.xml"
 */
export function buildFnoPath(input: BuildFnoPathInput): string {
  const host = extractHost(input.envUrl);
  const solution = nameSegment(input.solutionName);
  const config = nameSegment(input.configurationName);
  const version = input.version ? `@${slug(input.version)}` : '';
  return `fno://${host}/${solution}/${config}${version}.xml`;
}

function extractHost(envUrl: string): string {
  try {
    const u = new URL(envUrl);
    return u.host;
  } catch {
    // Fallback: strip scheme manually
    return envUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

/**
 * Path segment for a solution / configuration name.
 *
 * These keys are persisted (IndexedDB cache, recent sessions), so a name the
 * plain `slug` represents faithfully enough — anything ASCII without `@` —
 * keeps exactly the key it always had. Two cases were ambiguous and get a
 * short hash of the original name appended after `~` (a character `slug`
 * never emits, so it cannot collide with a plain key):
 *   - non-ASCII characters, which `slug` drops: CJK names collapsed to an
 *     empty segment, and `Faktura` / `Fakturá` shared one key;
 *   - `@`, which is the version separator: name `Foo@1` looked like `Foo`
 *     version 1. The `@` itself is removed from the segment.
 */
function nameSegment(name: string): string {
  const trimmed = name.trim();
  const lossy = /[^\x00-\x7F]/.test(trimmed) || trimmed.includes('@');
  if (!lossy) return slug(trimmed);
  const base = slug(trimmed.replace(/@/g, ''));
  return `${base}~${hashName(trimmed.normalize('NFC'))}`;
}

/** FNV-1a (32-bit) over UTF-16 code units, base36. Stable, not cryptographic. */
function hashName(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function slug(s: string): string {
  return s
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^A-Za-z0-9._@-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
