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
  const solution = slug(input.solutionName);
  const config = slug(input.configurationName);
  const version = input.version ? `@${slug(input.version)}` : '';
  return `fno://${host}/${solution}/${config}${version}.xml`;
}

/** Return true if `filePath` was produced by `buildFnoPath`. */
export function isFnoPath(filePath: string): boolean {
  return filePath.startsWith('fno://');
}

/** Parse the host (envUrl host) from a synthetic fno path. Returns null if invalid. */
export function extractHostFromFnoPath(filePath: string): string | null {
  if (!isFnoPath(filePath)) return null;
  const rest = filePath.slice('fno://'.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? rest : rest.slice(0, slash);
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

function slug(s: string): string {
  return s
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^A-Za-z0-9._@-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
