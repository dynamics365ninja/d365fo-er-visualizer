/**
 * High-level F&O session service used by UI components.
 *
 *   import { fnoSession } from './fno/session';
 *   await fnoSession.signIn(profile);
 *   const solutions = await fnoSession.listSolutions(profile);
 *   ...
 *
 * Tokens are cached in-memory keyed by connection id with a small safety
 * margin so we don't hand out about-to-expire tokens.
 */

import {
  buildFnoPath,
  downloadConfigXml,
  listComponents,
  listSolutions,
  type AuthResult,
  type ErComponentType,
  type ErConfigDownload,
  type ErConfigSummary,
  type ErSolutionSummary,
  type FnoConnection,
  type FnoTransport,
} from '@er-visualizer/fno-client';
import { parseERConfigurations } from '@er-visualizer/core';
import { getAuthProvider } from './auth-factory';
import { describeSummary, fnoDebugEnabled, fnoDebugMatches, recordFnoDebug } from './debug';
import { registerHarvestedLabels } from '../utils/label-resolver';
import { createFnoTransport } from './transport';

const TOKEN_MIN_LIFETIME_MS = 60_000;

// ── Download progress events ─────────────────────────────────────────────────
// Every `downloadConfiguration` call reports its lifecycle here so the UI can
// render a per-configuration progress log without threading callbacks through
// the (large) ingest pipeline in FnoConnectPanel.

export type FnoDownloadEvent =
  | { type: 'start'; component: ErConfigSummary }
  | { type: 'done'; component: ErConfigSummary; download: ErConfigDownload }
  | { type: 'error'; component: ErConfigSummary; error: unknown };

type DownloadListener = (event: FnoDownloadEvent) => void;
const downloadListeners = new Set<DownloadListener>();

/** Subscribe to download lifecycle events. Returns an unsubscribe function. */
export function onFnoDownloadEvent(listener: DownloadListener): () => void {
  downloadListeners.add(listener);
  return () => downloadListeners.delete(listener);
}

function emitDownloadEvent(event: FnoDownloadEvent): void {
  for (const listener of downloadListeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn('[fno-session] download listener failed', err);
    }
  }
}

/**
 * Pull the label dictionary out of every F&O response — including silent
 * scout/probe/ancestor downloads that are never loaded as configurations —
 * into the shared pool. Only the format response carries it; data model and
 * mapping responses reference labels they never define.
 */
function harvestLabels(component: ErConfigSummary, xml: string): void {
  try {
    const parsed = parseERConfigurations(xml, `fno-harvest://${component.configurationName}`);
    const labels = parsed.flatMap(c => c.solutionVersion?.solution?.labels ?? []);
    const added = registerHarvestedLabels(labels);
    console.info('[fno-ui] labels in response', {
      component: component.configurationName,
      type: component.componentType,
      labelsInResponse: labels.length,
      newInPool: added,
    });
  } catch (err) {
    console.info('[fno-ui] labels: response not parseable for harvesting', { component: component.configurationName, err });
  }
}

/** Structural fingerprint of a downloaded payload, for the debug recorder. */
function describePayload(xml: string): Record<string, unknown> {
  const directions = new Set<string>();
  for (const m of xml.matchAll(/([A-Za-z]*Direction)\s*=\s*"([^"]{0,80})"/g)) {
    directions.add(`${m[1]}=${m[2]}`);
    if (directions.size >= 4) break;
  }
  const datasources = (xml.match(/<Datasource[\s>][\s\S]*?<\/Datasource>/gi) ?? []).join('');
  return {
    length: xml.length,
    hasModelMapping: /<ERModelMapping[\s>]/i.test(xml),
    hasImportFormatDatasource: /<ERImportFormatDatasource[\s>]/i.test(xml),
    modelDefinitionFilled: /<ValueSource[\s>]/i.test(datasources),
    directions: [...directions],
  };
}

const tokenCache = new Map<string, AuthResult>();
let sharedTransport: FnoTransport | null = null;

function transport(): FnoTransport {
  if (!sharedTransport) sharedTransport = createFnoTransport();
  return sharedTransport;
}

async function ensureToken(conn: FnoConnection, signal?: AbortSignal): Promise<AuthResult> {
  const cached = tokenCache.get(conn.id);
  if (cached && cached.expiresAt > Date.now() + TOKEN_MIN_LIFETIME_MS) {
    return cached;
  }
  const fresh = await (await getAuthProvider()).acquireToken(conn, signal);
  tokenCache.set(conn.id, fresh);
  return fresh;
}

export const fnoSession = {
  async signIn(conn: FnoConnection, signal?: AbortSignal): Promise<AuthResult> {
    const result = await (await getAuthProvider()).acquireToken(conn, signal);
    tokenCache.set(conn.id, result);
    return result;
  },

  async signOut(conn: FnoConnection): Promise<void> {
    tokenCache.delete(conn.id);
    await (await getAuthProvider()).signOut(conn);
  },

  async getAccount(conn: FnoConnection) {
    return (await getAuthProvider()).getAccount(conn);
  },

  async listSolutions(
    conn: FnoConnection,
    signal?: AbortSignal,
    options?: { extraRoots?: readonly string[] },
  ): Promise<ErSolutionSummary[]> {
    const auth = await ensureToken(conn, signal);
    // Merge roots persisted on the profile with call-time extras.
    const extraRoots = [...(conn.extraRoots ?? []), ...(options?.extraRoots ?? [])];
    return listSolutions(transport(), conn, auth.accessToken, signal,
      extraRoots.length > 0 ? { ...options, extraRoots } : options);
  },

  async listComponents(
    conn: FnoConnection,
    solutionName: string,
    opts?: { componentType?: ErComponentType; signal?: AbortSignal },
  ): Promise<ErConfigSummary[]> {
    const auth = await ensureToken(conn, opts?.signal);
    const all = await listComponents(transport(), conn, auth.accessToken, solutionName, opts?.signal);
    recordFnoDebug('listComponents', {
      solutionName,
      count: all.length,
      rows: all.filter(c => fnoDebugMatches(c.configurationName) || fnoDebugMatches(c.solutionName))
        .map(describeSummary),
    });
    return opts?.componentType ? all.filter((c: ErConfigSummary) => c.componentType === opts.componentType) : all;
  },

  async downloadConfiguration(
    conn: FnoConnection,
    component: ErConfigSummary,
    signal?: AbortSignal,
    opts?: { silent?: boolean },
  ): Promise<ErConfigDownload> {
    // Scout/probe downloads (GUID discovery) are internal plumbing — they are
    // never loaded into the workspace, so keep them out of the ingest log.
    const emit = opts?.silent ? () => {} : emitDownloadEvent;
    emit({ type: 'start', component });
    try {
      const auth = await ensureToken(conn, signal);
      const download = await downloadConfigXml(transport(), conn, auth.accessToken, component, signal);
      recordFnoDebug('download', {
        asked: describeSummary(component),
        silent: opts?.silent ?? false,
        resolvedWith: download.resolvedWith,
        // The first line of the payload names the configuration F&O actually
        // returned — the one place that tells a derived config from its base.
        xmlHead: download.xml.slice(0, 400),
        // What the payload actually contains. An import format always has a
        // model mapping on itself (the format parses the file straight into the
        // model), and that mapping is the only artefact carrying the model's
        // GUID — so whether F&O includes it here decides whether the model and
        // its mappings are reachable at all. `directions` reports the attribute
        // verbatim instead of guessing how the enum is serialised.
        payload: fnoDebugEnabled() ? describePayload(download.xml) : undefined,
      });
      harvestLabels(component, download.xml);
      emit({ type: 'done', component, download });
      return download;
    } catch (error) {
      recordFnoDebug('download-failed', {
        asked: describeSummary(component),
        error: error instanceof Error ? error.message : String(error),
      });
      emit({ type: 'error', component, error });
      throw error;
    }
  },

  buildPath(conn: FnoConnection, component: ErConfigSummary): string {
    return buildFnoPath({
      envUrl: conn.envUrl,
      solutionName: component.solutionName,
      configurationName: component.configurationName,
      version: component.version,
      componentType: component.componentType,
    });
  },

  /** Drop cached access token; useful for tests and explicit refresh. */
  clearTokenCache(connId?: string): void {
    if (connId) tokenCache.delete(connId);
    else tokenCache.clear();
  },
};
