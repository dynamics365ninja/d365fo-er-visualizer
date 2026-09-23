/**
 * F&O auth + HTTP for Electron main process.
 *
 * - Auth: MSAL Node public client, Authorization Code flow with PKCE (S256)
 *   and a random `state`, redirected to a loopback listener.
 * - Token cache: one file per (tenant, client) sign-in context in
 *   `app.getPath('userData')`, encrypted with `safeStorage`. When the OS offers
 *   no encryption the cache stays in memory only — refresh tokens are never
 *   written in plain text.
 * - Accounts: each connection remembers the account it signed in with, so two
 *   profiles on different accounts no longer share whichever MSAL lists first.
 * - HTTP: `net.request` from Electron. No CORS, native cookies disabled,
 *   redirects are not followed (see `fnoRequest`).
 * - IPC: every handler checks that the caller is the app's own renderer and
 *   validates its payload; nothing from the renderer is trusted as typed.
 */

import { ipcMain, safeStorage, app, net, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import {
  CryptoProvider,
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
  type ICachePlugin,
  type TokenCacheContext,
  LogLevel,
} from '@azure/msal-node';
import type { FnoConnection } from '@er-visualizer/fno-client';
import { AUTHORITY_TENANT, BUILT_IN_CLIENT_ID } from './built-in-client';

/**
 * Connection profiles carry no Entra identifiers — every sign-in uses the
 * shell's built-in multi-tenant registration. A legacy profile that still has
 * its own `clientId` keeps working and overrides the built-in one.
 */
function resolveClientId(conn: FnoConnection): string {
  const explicit = (conn.clientId ?? '').trim();
  if (explicit) return explicit;
  if (BUILT_IN_CLIENT_ID) return BUILT_IN_CLIENT_ID;
  throw new Error(
    'This build has no Entra application (client) ID configured, so sign-in ' +
      'cannot run. Set FNO_CLIENT_ID, or bake one into ' +
      'packages/electron/src/fno/built-in-client.ts.',
  );
}

function resolveTenantId(conn: FnoConnection): string {
  return (conn.tenantId ?? '').trim() || AUTHORITY_TENANT;
}

/** Interactive sign-in must complete within this window, otherwise the
 * loopback listener is torn down and the renderer gets a clear error. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Outbound allow-list for `fno:request` and connection `envUrl`s. Mirrors the
 * web proxy (packages/site/app/api/fno/route.ts): HTTPS only, F&O environment
 * hosts only — `<env>[.sandbox].operations[.<region>].dynamics.com` and the
 * cloud-hosted / legacy `cloudax`, `axcloud`, `sandbox.ax` families, plus
 * `cloud.onebox` for Tier-1 development VMs.
 */
const ALLOWED_HOST_PATTERNS = [
  /^(?:[a-z0-9-]+\.)+operations(?:\.[a-z]{2,8})?\.dynamics\.com$/i,
  /^(?:[a-z0-9-]+\.)+(?:cloudax|axcloud|sandbox\.ax|cloud\.onebox)\.dynamics\.com$/i,
];

function isAllowedTarget(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 8192) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password || url.port) return false;
  return ALLOWED_HOST_PATTERNS.some(re => re.test(url.hostname));
}

/** Default and bounds for a renderer-supplied request timeout. */
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
/** Largest request body the renderer may send (custom-service JSON is tiny). */
const MAX_REQUEST_BODY_CHARS = 1024 * 1024;
/** Largest upstream response accepted. Big ER bundles run to tens of MB. */
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;

interface FnoAuthResult {
  accessToken: string;
  expiresAt: number;
  account: { username: string; tenantId: string; homeAccountId?: string; name?: string } | null;
  envUrl: string;
}

interface FnoRequestPayload {
  url: string;
  token: string;
  responseType: 'json' | 'binary';
  timeoutMs: number;
  /** HTTP method. Defaults to 'GET'. */
  method: 'GET' | 'POST';
  /**
   * Request body as a pre-serialized string. Pair with a matching
   * `contentType` header. Ignored for GET.
   */
  body?: string;
  /**
   * Content-Type header for the request body. Defaults to
   * `application/json; charset=utf-8` when a body is present.
   */
  contentType?: string;
  /** Renderer-chosen id that `fno:abort` uses to cancel this request. */
  requestId?: string;
}

interface FnoResponsePayload {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  // One of these is set depending on responseType. `json` is present only when
  // the body parsed (an empty body is `null`); otherwise `bodyText` carries it
  // so the renderer can report what F&O actually sent.
  json?: unknown;
  // binary is returned as base64 so it can cross the IPC boundary cleanly
  binaryBase64?: string;
  bodyText?: string;
}

// ─── Payload validation ───

function isShortString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

/** Rebuild a connection from renderer input, keeping only fields main uses. */
function parseConnection(raw: unknown): FnoConnection {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid connection');
  const r = raw as Record<string, unknown>;
  if (!isShortString(r.id, 200)) throw new Error('Invalid connection id');
  if (!isAllowedTarget(r.envUrl)) {
    throw new Error('Connection envUrl must be an https:// Dynamics 365 Finance & Operations environment URL');
  }
  const optional = (v: unknown, name: string): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (!isShortString(v, 200) || /[\s/\\?#]/.test(v.trim())) throw new Error(`Invalid connection ${name}`);
    return v;
  };
  return {
    id: r.id,
    displayName: isShortString(r.displayName, 500) ? r.displayName : '',
    envUrl: r.envUrl,
    tenantId: optional(r.tenantId, 'tenantId'),
    clientId: optional(r.clientId, 'clientId'),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  };
}

function parseRequestPayload(raw: unknown): FnoRequestPayload {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid request payload');
  const r = raw as Record<string, unknown>;
  if (!isAllowedTarget(r.url)) {
    throw new Error(`Target host not allowed: ${typeof r.url === 'string' ? r.url.slice(0, 200) : typeof r.url}`);
  }
  if (!isShortString(r.token, 32 * 1024) || r.token.length === 0 || /[\r\n]/.test(r.token)) {
    throw new Error('Invalid token');
  }
  if (r.responseType !== 'json' && r.responseType !== 'binary') throw new Error('Invalid responseType');
  const method = r.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') throw new Error('Invalid method');
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (r.timeoutMs !== undefined) {
    if (typeof r.timeoutMs !== 'number' || !Number.isFinite(r.timeoutMs)) throw new Error('Invalid timeoutMs');
    timeoutMs = Math.min(Math.max(Math.round(r.timeoutMs), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }
  if (r.body !== undefined && !isShortString(r.body, MAX_REQUEST_BODY_CHARS)) throw new Error('Invalid body');
  if (r.contentType !== undefined && (!isShortString(r.contentType, 200) || /[\r\n]/.test(r.contentType))) {
    throw new Error('Invalid contentType');
  }
  if (r.requestId !== undefined && !isShortString(r.requestId, 100)) throw new Error('Invalid requestId');
  return {
    url: r.url,
    token: r.token,
    responseType: r.responseType,
    method,
    timeoutMs,
    body: r.body as string | undefined,
    contentType: r.contentType as string | undefined,
    requestId: r.requestId as string | undefined,
  };
}

// ─── Token cache plugin (encrypted at rest, or memory-only) ───

/** Cache file per sign-in context. The built-in context keeps the original
 * file name so existing sign-ins survive the switch to per-context files. */
function cachePath(key: string): string {
  const builtInKey = `${AUTHORITY_TENANT}::${BUILT_IN_CLIENT_ID}`;
  const name = key === builtInKey
    ? 'fno-tokens.enc'
    : `fno-tokens-${createHash('sha256').update(key).digest('hex').slice(0, 16)}.enc`;
  return path.join(app.getPath('userData'), name);
}

let warnedNoEncryption = false;

function makeCachePlugin(key: string): ICachePlugin {
  const file = cachePath(key);
  return {
    async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
      // Without OS encryption the cache lives only in MSAL's memory, so there
      // is nothing on disk to load (and an older plaintext file is ignored).
      if (!safeStorage.isEncryptionAvailable()) return;
      try {
        if (!fs.existsSync(file)) return;
        ctx.tokenCache.deserialize(safeStorage.decryptString(fs.readFileSync(file)));
      } catch (err) {
        // If the cache is corrupted/unreadable, start fresh.
        console.warn('[fno-auth] Could not read token cache:', err);
      }
    },
    async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
      if (!ctx.cacheHasChanged) return;
      if (!safeStorage.isEncryptionAvailable()) {
        if (!warnedNoEncryption) {
          warnedNoEncryption = true;
          console.warn(
            '[fno-auth] OS encryption (safeStorage) is unavailable; keeping the token cache in memory only. ' +
              'You will need to sign in again after restarting the app.',
          );
        }
        return;
      }
      try {
        const enc = safeStorage.encryptString(ctx.tokenCache.serialize());
        fs.writeFileSync(file, enc, { mode: 0o600 });
      } catch (err) {
        console.warn('[fno-auth] Could not persist token cache:', err);
      }
    },
  };
}

// ─── Remembered account per connection ───

/**
 * Which MSAL account each connection signed in with (`homeAccountId`, not a
 * secret). `byContext` holds the latest sign-in per (tenant, client) so a new
 * profile on the same registration still reuses that sign-in silently.
 */
interface AccountMap {
  byConnection: Record<string, string>;
  byContext: Record<string, string>;
}

function accountMapPath(): string {
  return path.join(app.getPath('userData'), 'fno-accounts.json');
}

let accountMap: AccountMap | null = null;

function loadAccountMap(): AccountMap {
  if (accountMap) return accountMap;
  accountMap = { byConnection: {}, byContext: {} };
  try {
    if (fs.existsSync(accountMapPath())) {
      const parsed = JSON.parse(fs.readFileSync(accountMapPath(), 'utf-8')) as Partial<AccountMap>;
      if (parsed && typeof parsed === 'object') {
        accountMap.byConnection = { ...(parsed.byConnection ?? {}) };
        accountMap.byContext = { ...(parsed.byContext ?? {}) };
      }
    }
  } catch (err) {
    console.warn('[fno-auth] Could not read account map:', err);
  }
  return accountMap;
}

function saveAccountMap(): void {
  try {
    fs.writeFileSync(accountMapPath(), JSON.stringify(loadAccountMap()), { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.warn('[fno-auth] Could not persist account map:', err);
  }
}

function connectionKey(conn: FnoConnection): string {
  return `${msalKey(conn)}|${conn.id || conn.envUrl.replace(/\/+$/, '').toLowerCase()}`;
}

function rememberAccount(conn: FnoConnection, homeAccountId: string | undefined): void {
  if (!homeAccountId) return;
  const map = loadAccountMap();
  const connKey = connectionKey(conn);
  const ctxKey = msalKey(conn);
  if (map.byConnection[connKey] === homeAccountId && map.byContext[ctxKey] === homeAccountId) return;
  map.byConnection[connKey] = homeAccountId;
  map.byContext[ctxKey] = homeAccountId;
  saveAccountMap();
}

function forgetAccount(conn: FnoConnection, homeAccountId: string | undefined): void {
  const map = loadAccountMap();
  delete map.byConnection[connectionKey(conn)];
  if (homeAccountId && map.byContext[msalKey(conn)] === homeAccountId) delete map.byContext[msalKey(conn)];
  saveAccountMap();
}

/**
 * The cached account this connection should use: the one it signed in with,
 * else the latest sign-in on the same registration, else the only cached
 * account. A remembered account that is gone yields `null` — never a
 * different user's account.
 */
async function selectAccount(conn: FnoConnection, msal: PublicClientApplication): Promise<AccountInfo | null> {
  const accounts = await msal.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null;
  const map = loadAccountMap();
  const own = map.byConnection[connectionKey(conn)];
  if (own) return accounts.find(a => a.homeAccountId === own) ?? null;
  const shared = map.byContext[msalKey(conn)];
  const sharedAccount = shared ? accounts.find(a => a.homeAccountId === shared) : undefined;
  if (sharedAccount) return sharedAccount;
  return accounts.length === 1 ? accounts[0] : null;
}

// ─── MSAL app pool (one per clientId + tenant combo) ───

const msalPool = new Map<string, PublicClientApplication>();

function msalKey(conn: FnoConnection): string {
  return `${resolveTenantId(conn)}::${resolveClientId(conn)}`;
}

function getMsalApp(conn: FnoConnection): PublicClientApplication {
  const key = msalKey(conn);
  const cached = msalPool.get(key);
  if (cached) return cached;
  const config: Configuration = {
    auth: {
      clientId: resolveClientId(conn),
      authority: `https://login.microsoftonline.com/${encodeURIComponent(resolveTenantId(conn))}`,
    },
    cache: {
      cachePlugin: makeCachePlugin(key),
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
        loggerCallback: (level, message) => {
          if (level <= LogLevel.Warning) console.warn('[msal]', message);
        },
      },
    },
  };
  const app = new PublicClientApplication(config);
  msalPool.set(key, app);
  return app;
}

function buildScope(conn: FnoConnection): string {
  return `${conn.envUrl.replace(/\/+$/, '')}/.default`;
}

// ─── Loopback redirect listener for Authorization Code flow ───

interface LoopbackResult {
  code: string;
  state: string;
  redirectUri: string;
}

async function startLoopbackListener(): Promise<{
  redirectUri: string;
  waitForCode: (expectedState: string, signal?: AbortSignal) => Promise<LoopbackResult>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let resolveCode: ((result: LoopbackResult) => void) | null = null;
    let rejectCode: ((err: Error) => void) | null = null;

    server.on('request', (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state') ?? '';
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>Sign-in failed</h1><p>${escapeHtml(error)}: ${escapeHtml(errorDesc ?? '')}</p>`);
          rejectCode?.(new Error(`Sign-in failed: ${error}: ${errorDesc ?? ''}`));
          return;
        }
        if (!code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>D365FO ER Visualizer</h1><p>Signing in…</p>');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Done</h1><p>You can close this window and return to the application.</p>');
        resolveCode?.({
          code,
          state,
          redirectUri: `http://localhost:${(server.address() as { port: number }).port}/`,
        });
      } catch (err) {
        rejectCode?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind loopback listener'));
        return;
      }
      const redirectUri = `http://localhost:${addr.port}/`;
      resolve({
        redirectUri,
        waitForCode(expectedState, signal) {
          return new Promise<LoopbackResult>((res, rej) => {
            resolveCode = (result: LoopbackResult) => {
              if (result.state !== expectedState) {
                rej(new Error('State mismatch (possible CSRF)'));
                return;
              }
              res(result);
            };
            rejectCode = rej;
            if (signal?.aborted) {
              rej(signal.reason instanceof Error ? signal.reason : new Error('Sign-in aborted'));
              return;
            }
            signal?.addEventListener(
              'abort',
              () => rej(signal.reason instanceof Error ? signal.reason : new Error('Sign-in aborted')),
              { once: true },
            );
          });
        },
        close: () => server.close(),
      });
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

// ─── Public login/silent/logout flows ───

const cryptoProvider = new CryptoProvider();

async function login(conn: FnoConnection): Promise<FnoAuthResult> {
  const msal = getMsalApp(conn);
  const scope = buildScope(conn);
  const listener = await startLoopbackListener();
  try {
    // Unguessable CSRF token, and a PKCE pair binding the code to this
    // process — msal-node does not add PKCE to getAuthCodeUrl on its own.
    const state = randomUUID();
    const pkce = await cryptoProvider.generatePkceCodes();
    const authUrl = await msal.getAuthCodeUrl({
      scopes: [scope],
      redirectUri: listener.redirectUri,
      state,
      prompt: 'select_account',
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
    });
    console.info('[fno-auth] login starting', {
      tenantId: resolveTenantId(conn),
      clientId: resolveClientId(conn),
      scope,
      redirectUri: listener.redirectUri,
    });
    await shell.openExternal(authUrl);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort(new Error(`Sign-in timed out after ${Math.round(LOGIN_TIMEOUT_MS / 60000)} minutes`));
    }, LOGIN_TIMEOUT_MS);
    let code: string;
    try {
      ({ code } = await listener.waitForCode(state, abort.signal));
    } finally {
      clearTimeout(timer);
    }
    try {
      const tokenResult = await msal.acquireTokenByCode({
        code,
        scopes: [scope],
        redirectUri: listener.redirectUri,
        codeVerifier: pkce.verifier,
      });
      if (!tokenResult) throw new Error('MSAL returned no token');
      rememberAccount(conn, tokenResult.account?.homeAccountId);
      return toAuthResult(tokenResult, conn.envUrl);
    } catch (err) {
      // MSAL errors carry useful fields (errorCode, errorMessage, correlationId).
      // Surface them to the renderer so the UI can show a real reason.
      const e = err as {
        errorCode?: string;
        errorMessage?: string;
        subError?: string;
        correlationId?: string;
        message?: string;
      };
      console.error('[fno-auth] acquireTokenByCode failed', {
        errorCode: e?.errorCode,
        subError: e?.subError,
        correlationId: e?.correlationId,
        message: e?.errorMessage ?? e?.message,
      });
      const reason = e?.errorMessage || e?.message || 'Unknown error';
      const code2 = e?.errorCode ? ` [${e.errorCode}]` : '';
      throw new Error(`Token exchange failed${code2}: ${reason}`);
    }
  } finally {
    listener.close();
  }
}

async function acquireSilent(conn: FnoConnection): Promise<FnoAuthResult | null> {
  const msal = getMsalApp(conn);
  const account = await selectAccount(conn, msal);
  if (!account) return null;
  try {
    const tokenResult = await msal.acquireTokenSilent({
      account,
      scopes: [buildScope(conn)],
    });
    if (!tokenResult) return null;
    // Pin a connection that got here through the shared/single-account
    // fallback to that account from now on.
    rememberAccount(conn, tokenResult.account?.homeAccountId ?? account.homeAccountId);
    return toAuthResult(tokenResult, conn.envUrl);
  } catch {
    return null;
  }
}

async function getAccount(conn: FnoConnection) {
  const msal = getMsalApp(conn);
  const a = await selectAccount(conn, msal);
  if (!a) return null;
  return {
    username: a.username,
    tenantId: a.tenantId,
    homeAccountId: a.homeAccountId,
    name: a.name,
  };
}

/** Sign this connection's account out — other profiles' accounts stay signed in. */
async function signOut(conn: FnoConnection): Promise<void> {
  const msal = getMsalApp(conn);
  const account = await selectAccount(conn, msal);
  if (account) await msal.getTokenCache().removeAccount(account);
  forgetAccount(conn, account?.homeAccountId);
}

function toAuthResult(r: { accessToken: string; expiresOn: Date | null; account: { username: string; tenantId: string; homeAccountId?: string; name?: string } | null }, envUrl: string): FnoAuthResult {
  return {
    accessToken: r.accessToken,
    expiresAt: r.expiresOn ? r.expiresOn.getTime() : Date.now() + 55 * 60 * 1000,
    account: r.account ? {
      username: r.account.username,
      tenantId: r.account.tenantId,
      homeAccountId: r.account.homeAccountId,
      name: r.account.name,
    } : null,
    envUrl,
  };
}

// ─── HTTP request via Electron net.request ───

/** In-flight requests by `${webContentsId}:${requestId}`, for `fno:abort`. */
const inFlightRequests = new Map<string, () => void>();

/**
 * Same wording and status as the web proxy's answer to an upstream 3xx
 * (packages/site/app/api/fno/route.ts), so both hosts report it identically.
 */
function redirectResponse(status: number, location: string): FnoResponsePayload {
  return {
    status: 502,
    statusText: 'Bad Gateway',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-fno-proxy-upstream-status': String(status),
      'x-fno-proxy-upstream-location': location,
    },
    bodyText:
      `Upstream F&O redirected (${status}) to ${location}.\n` +
      `This usually means the access token was rejected and F&O issued a ` +
      `login redirect. Check tenantId, clientId, and that the token audience ` +
      `matches envUrl.`,
  };
}

async function fnoRequest(payload: FnoRequestPayload, abortKey?: string): Promise<FnoResponsePayload> {
  return new Promise((resolve, reject) => {
    const method = payload.method;
    const hasBody = method !== 'GET' && typeof payload.body === 'string';
    // Redirects are never followed: the allow-list was checked for this URL
    // only, and F&O redirects a rejected token to the sign-in page.
    const request = net.request({
      method,
      url: payload.url,
      redirect: 'manual',
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (abortKey) inFlightRequests.delete(abortKey);
      fn();
    };
    const fail = (err: Error) => {
      finish(() => reject(err));
      request.abort();
    };

    request.setHeader('Authorization', `Bearer ${payload.token}`);
    request.setHeader('Accept', payload.responseType === 'json' ? 'application/json' : 'application/octet-stream, */*');
    if (hasBody) {
      request.setHeader('Content-Type', payload.contentType ?? 'application/json; charset=utf-8');
    }
    const timeout = setTimeout(() => {
      fail(new Error(`Request timed out after ${payload.timeoutMs}ms: ${payload.url}`));
    }, payload.timeoutMs);
    if (abortKey) {
      inFlightRequests.set(abortKey, () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        fail(err);
      });
    }

    request.on('redirect', (statusCode, _method, redirectUrl) => {
      // Not calling followRedirect() cancels the redirect; report it instead.
      finish(() => resolve(redirectResponse(statusCode, redirectUrl)));
      request.abort();
    });

    request.on('response', response => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', chunk => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        if (received > MAX_RESPONSE_BYTES) {
          fail(new Error(`Response exceeds ${Math.round(MAX_RESPONSE_BYTES / (1024 * 1024))} MB: ${payload.url}`));
          return;
        }
        chunks.push(buf);
      });
      response.on('end', () => {
        if (settled) return;
        const buf = Buffer.concat(chunks);
        const status = response.statusCode;
        const statusText = response.statusMessage ?? '';
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(response.headers ?? {})) {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        if (payload.responseType === 'json') {
          const text = buf.toString('utf-8');
          const ok = status >= 200 && status < 300;
          let json: unknown = undefined;
          try {
            json = text.trim().length > 0 ? JSON.parse(text.replace(/^﻿/, '')) : null;
          } catch {
            // not JSON — the renderer reports it from bodyText
          }
          // Send the body once: parsed on success, as text when it is needed
          // for an error message.
          finish(() => resolve(
            ok && json !== undefined
              ? { status, statusText, headers, json }
              : { status, statusText, headers, bodyText: text },
          ));
        } else {
          finish(() => resolve({
            status,
            statusText,
            headers,
            binaryBase64: buf.toString('base64'),
            bodyText: undefined,
          }));
        }
      });
      response.on('error', (err: Error) => fail(err));
    });
    request.on('error', err => fail(err));
    if (hasBody) {
      request.write(payload.body as string, 'utf-8');
    }
    request.end();
  });
}

// ─── IPC registration ───

export interface FnoIpcOptions {
  /** True when `url` is the app's own renderer document (see main.ts). */
  isTrustedRendererUrl: (url: string) => boolean;
}

export function registerFnoIpc(options: FnoIpcOptions): void {
  const assertTrusted = (evt: IpcMainInvokeEvent | IpcMainEvent): void => {
    const url = evt.senderFrame?.url;
    if (!url || !options.isTrustedRendererUrl(url)) {
      throw new Error('F&O IPC is only available to the application window');
    }
  };

  ipcMain.handle('fno:auth:login', async (evt, conn: unknown) => {
    assertTrusted(evt);
    return login(parseConnection(conn));
  });
  ipcMain.handle('fno:auth:silent', async (evt, conn: unknown) => {
    assertTrusted(evt);
    return acquireSilent(parseConnection(conn));
  });
  ipcMain.handle('fno:auth:account', async (evt, conn: unknown) => {
    assertTrusted(evt);
    return getAccount(parseConnection(conn));
  });
  ipcMain.handle('fno:auth:logout', async (evt, conn: unknown) => {
    assertTrusted(evt);
    await signOut(parseConnection(conn));
    return true;
  });
  ipcMain.handle('fno:request', async (evt, raw: unknown) => {
    assertTrusted(evt);
    const payload = parseRequestPayload(raw);
    const abortKey = payload.requestId ? `${evt.sender.id}:${payload.requestId}` : undefined;
    return fnoRequest(payload, abortKey);
  });
  // Fire-and-forget: the renderer's AbortSignal fired for `requestId`.
  ipcMain.on('fno:abort', (evt, requestId: unknown) => {
    try {
      assertTrusted(evt);
    } catch {
      return;
    }
    if (!isShortString(requestId, 100)) return;
    inFlightRequests.get(`${evt.sender.id}:${requestId}`)?.();
  });
}
