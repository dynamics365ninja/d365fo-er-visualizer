import type {
  FnoTransport,
  FnoConnection,
  ErSolutionSummary,
  ErConfigSummary,
  ErConfigDownload,
  ErComponentType,
} from './types';
import { FnoHttpError, FnoSourceUnsupportedError } from './types';
import { buildFnoPath } from './path-key';

/**
 * F&O OData client for enumerating and downloading ER configurations.
 *
 * This module is host-agnostic: it receives a {@link FnoTransport} which is
 * responsible for actual network I/O (native in Electron, `fetch` in browser).
 */

interface OdataListResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

/**
 * Enumerate all ER solutions available in the environment.
 */
export async function listSolutions(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  signal?: AbortSignal,
): Promise<ErSolutionSummary[]> {
  const baseUrl = `${normalizeEnvUrl(conn.envUrl)}/data/ERSolutionEntity`;
  const params = new URLSearchParams({
    'cross-company': 'true',
    $select: 'SolutionName,Publisher,SolutionVersion,SolutionDisplayName',
  });
  const results = await fetchAllPages<RawErSolutionRow>(
    transport,
    `${baseUrl}?${params.toString()}`,
    token,
    signal,
  );
  return results.map(mapSolutionRow);
}

/**
 * Enumerate configuration components inside a single solution.
 */
export async function listComponents(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  solutionName: string,
  signal?: AbortSignal,
): Promise<ErConfigSummary[]> {
  const baseUrl = `${normalizeEnvUrl(conn.envUrl)}/data/ERSolutionComponentEntity`;
  const filter = `SolutionName eq '${escapeODataString(solutionName)}'`;
  const params = new URLSearchParams({
    'cross-company': 'true',
    $filter: filter,
    $select: [
      'SolutionName',
      'ConfigurationName',
      'ComponentType',
      'ConfigurationVersion',
      'ConfigurationRevisionGuid',
      'ConfigurationGuid',
      'CountryRegion',
    ].join(','),
  });
  const rows = await fetchAllPages<RawErComponentRow>(
    transport,
    `${baseUrl}?${params.toString()}`,
    token,
    signal,
  );
  return rows.map(r => mapComponentRow(r, solutionName));
}

/**
 * Download the XML content for a single configuration component.
 *
 * F&O exposes configuration XML through a few different endpoints depending
 * on the version. This tries the primary path first, then falls back.
 * If all endpoints fail, {@link FnoSourceUnsupportedError} is thrown with a
 * descriptive message.
 */
export async function downloadConfigXml(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  component: ErConfigSummary,
  signal?: AbortSignal,
): Promise<ErConfigDownload> {
  const base = normalizeEnvUrl(conn.envUrl);
  const attempts: Array<{ label: string; url: string }> = [];

  if (component.revisionGuid) {
    attempts.push({
      label: 'ERConfigurationRevisionEntity/Content',
      url: `${base}/data/ERConfigurationRevisionEntity(guid'${component.revisionGuid}')/Content`,
    });
  }
  if (component.configurationGuid) {
    attempts.push({
      label: 'ERSolutionComponentEntity/Content',
      url: `${base}/data/ERSolutionComponentEntity(guid'${component.configurationGuid}')/Content`,
    });
  }

  if (attempts.length === 0) {
    throw new FnoSourceUnsupportedError(
      `Component "${component.configurationName}" has neither revisionGuid nor configurationGuid — cannot download.`,
    );
  }

  const errors: Array<{ label: string; error: unknown }> = [];
  for (const attempt of attempts) {
    try {
      const buffer = await transport.getBinary(attempt.url, token, signal);
      const xml = decodeXmlPayload(buffer);
      return {
        xml,
        syntheticPath: buildFnoPath({
          envUrl: conn.envUrl,
          solutionName: component.solutionName,
          configurationName: component.configurationName,
          version: component.version,
          componentType: component.componentType,
        }),
        source: component,
      };
    } catch (err) {
      if (err instanceof FnoHttpError && (err.status === 404 || err.status === 400)) {
        errors.push({ label: attempt.label, error: err });
        continue; // try the next endpoint
      }
      throw err;
    }
  }

  throw new FnoSourceUnsupportedError(
    `Could not download XML for "${component.configurationName}". Tried: ${errors.map(e => e.label).join(', ')}.`,
  );
}

// ─── Internals ───

async function fetchAllPages<T>(
  transport: FnoTransport,
  firstUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | undefined = firstUrl;
  const maxPages = 200; // safety net
  for (let i = 0; i < maxPages && nextUrl; i++) {
    const page: OdataListResponse<T> = await transport.getJson<OdataListResponse<T>>(nextUrl, token, signal);
    if (Array.isArray(page.value)) out.push(...page.value);
    nextUrl = page['@odata.nextLink'];
  }
  return out;
}

function normalizeEnvUrl(envUrl: string): string {
  return envUrl.replace(/\/+$/, '');
}

/** Escape a single-quoted OData string literal (double the quote). */
export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Decode UTF-8 (strip BOM) from an ArrayBuffer. */
export function decodeXmlPayload(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let offset = 0;
  // Strip UTF-8 BOM
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    offset = 3;
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(view.subarray(offset));
  // Some F&O endpoints wrap payload in JSON like { "value": "<base64>" }; attempt
  // to unwrap that only if the payload looks like JSON and contains a base64 blob.
  if (text.startsWith('{') && text.includes('"value"')) {
    try {
      const parsed = JSON.parse(text) as { value?: string };
      if (typeof parsed.value === 'string' && parsed.value.length > 0) {
        return decodeBase64Utf8(parsed.value);
      }
    } catch {
      // fall through — return raw text
    }
  }
  return text;
}

function decodeBase64Utf8(b64: string): string {
  // Cross-platform base64 decode: Node has Buffer, browser has atob.
  // Keep this module host-agnostic by feature-detecting.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf-8').replace(/^\uFEFF/, '');
  }
  // Browser fallback
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

// ─── Row mapping ───

interface RawErSolutionRow {
  SolutionName?: string;
  Publisher?: string;
  SolutionVersion?: string;
  SolutionDisplayName?: string;
}

interface RawErComponentRow {
  SolutionName?: string;
  ConfigurationName?: string;
  ComponentType?: string;
  ConfigurationVersion?: string;
  ConfigurationRevisionGuid?: string;
  ConfigurationGuid?: string;
  CountryRegion?: string;
}

function mapSolutionRow(r: RawErSolutionRow): ErSolutionSummary {
  return {
    solutionName: r.SolutionName ?? '',
    publisher: r.Publisher,
    version: r.SolutionVersion,
    displayName: r.SolutionDisplayName && r.SolutionDisplayName !== r.SolutionName
      ? r.SolutionDisplayName
      : undefined,
  };
}

function mapComponentRow(r: RawErComponentRow, solutionName: string): ErConfigSummary {
  return {
    solutionName: r.SolutionName ?? solutionName,
    configurationName: r.ConfigurationName ?? '',
    componentType: mapComponentType(r.ComponentType),
    version: r.ConfigurationVersion,
    revisionGuid: r.ConfigurationRevisionGuid,
    configurationGuid: r.ConfigurationGuid,
    countryRegion: r.CountryRegion,
    hasContent: Boolean(r.ConfigurationRevisionGuid || r.ConfigurationGuid),
  };
}

function mapComponentType(raw?: string): ErComponentType {
  if (!raw) return 'Unknown';
  const lower = raw.toLowerCase();
  if (lower.includes('datamodel')) return 'DataModel';
  if (lower.includes('mapping')) return 'ModelMapping';
  if (lower.includes('format')) return 'Format';
  return 'Unknown';
}
