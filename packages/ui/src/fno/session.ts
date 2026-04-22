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
  const fresh = await getAuthProvider().acquireToken(conn, signal);
  tokenCache.set(conn.id, fresh);
  return fresh;
}

export const fnoSession = {
  async signIn(conn: FnoConnection, signal?: AbortSignal): Promise<AuthResult> {
    const result = await getAuthProvider().acquireToken(conn, signal);
    tokenCache.set(conn.id, result);
    return result;
  },

  async signOut(conn: FnoConnection): Promise<void> {
    tokenCache.delete(conn.id);
    await getAuthProvider().signOut(conn);
  },

  async getAccount(conn: FnoConnection) {
    return getAuthProvider().getAccount(conn);
  },

  async listSolutions(conn: FnoConnection, signal?: AbortSignal): Promise<ErSolutionSummary[]> {
    const auth = await ensureToken(conn, signal);
    return listSolutions(transport(), conn, auth.accessToken, signal);
  },

  async listComponents(
    conn: FnoConnection,
    solutionName: string,
    opts?: { componentType?: ErComponentType; signal?: AbortSignal },
  ): Promise<ErConfigSummary[]> {
    const auth = await ensureToken(conn, opts?.signal);
    const all = await listComponents(transport(), conn, auth.accessToken, solutionName, opts?.signal);
    return opts?.componentType ? all.filter(c => c.componentType === opts.componentType) : all;
  },

  async downloadConfiguration(
    conn: FnoConnection,
    component: ErConfigSummary,
    signal?: AbortSignal,
  ): Promise<ErConfigDownload> {
    const auth = await ensureToken(conn, signal);
    const download = await downloadConfigXml(transport(), conn, auth.accessToken, component, signal);
    return download;
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
