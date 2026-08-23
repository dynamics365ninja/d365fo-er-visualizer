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
import { getAuthProvider } from './auth-factory';
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
    return listSolutions(transport(), conn, auth.accessToken, signal, options);
  },

  async listComponents(
    conn: FnoConnection,
    solutionName: string,
    opts?: { componentType?: ErComponentType; signal?: AbortSignal },
  ): Promise<ErConfigSummary[]> {
    const auth = await ensureToken(conn, opts?.signal);
    const all = await listComponents(transport(), conn, auth.accessToken, solutionName, opts?.signal);
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
      emit({ type: 'done', component, download });
      return download;
    } catch (error) {
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
