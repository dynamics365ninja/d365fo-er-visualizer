/**
 * F&O auth + HTTP for Electron main process.
 *
 * - Auth: MSAL Node public client (Authorization Code + PKCE), loopback redirect.
 * - Token cache: persisted to a file in `app.getPath('userData')`, encrypted
 *   with `safeStorage.encryptString` when available.
 * - HTTP: `net.request` from Electron. No CORS, native cookies disabled.
 */

import { ipcMain, safeStorage, app, net, shell } from 'electron';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import {
  PublicClientApplication,
  type Configuration,
  type ICachePlugin,
  type TokenCacheContext,
  LogLevel,
} from '@azure/msal-node';

interface FnoConnection {
  id: string;
  displayName: string;
  envUrl: string;
  tenantId: string;
  clientId: string;
}

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
  timeoutMs?: number;
}

interface FnoResponsePayload {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  // One of these is set depending on responseType
  json?: unknown;
  // binary is returned as base64 so it can cross the IPC boundary cleanly
  binaryBase64?: string;
  bodyText?: string;
}

// ─── Token cache plugin (encrypted at rest) ───

function cachePath(): string {
  return path.join(app.getPath('userData'), 'fno-tokens.enc');
}

function makeCachePlugin(): ICachePlugin {
  return {
    async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
      try {
        if (!fs.existsSync(cachePath())) return;
        const buf = fs.readFileSync(cachePath());
        let serialized: string;
        if (safeStorage.isEncryptionAvailable()) {
          serialized = safeStorage.decryptString(buf);
        } else {
          serialized = buf.toString('utf-8');
        }
        ctx.tokenCache.deserialize(serialized);
      } catch (err) {
        // If the cache is corrupted/unreadable, start fresh.
        console.warn('[fno-auth] Could not read token cache:', err);
      }
    },
    async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
      if (!ctx.cacheHasChanged) return;
      try {
        const serialized = ctx.tokenCache.serialize();
        if (safeStorage.isEncryptionAvailable()) {
          const enc = safeStorage.encryptString(serialized);
          fs.writeFileSync(cachePath(), enc);
        } else {
          fs.writeFileSync(cachePath(), serialized, 'utf-8');
        }
      } catch (err) {
        console.warn('[fno-auth] Could not persist token cache:', err);
      }
    },
  };
}

// ─── MSAL app pool (one per clientId + tenant combo) ───

const msalPool = new Map<string, PublicClientApplication>();

function msalKey(conn: FnoConnection): string {
  return `${conn.tenantId}::${conn.clientId}`;
}

function getMsalApp(conn: FnoConnection): PublicClientApplication {
  const key = msalKey(conn);
  const cached = msalPool.get(key);
  if (cached) return cached;
  const config: Configuration = {
    auth: {
      clientId: conn.clientId,
      authority: `https://login.microsoftonline.com/${encodeURIComponent(conn.tenantId)}`,
    },
    cache: {
      cachePlugin: makeCachePlugin(),
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
          res.end(`<h1>Přihlášení selhalo</h1><p>${escapeHtml(error)}: ${escapeHtml(errorDesc ?? '')}</p>`);
          rejectCode?.(new Error(`${error}: ${errorDesc ?? ''}`));
          return;
        }
        if (!code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>D365FO ER Visualizer</h1><p>Probíhá přihlašování…</p>');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Hotovo</h1><p>Můžete zavřít toto okno a vrátit se do aplikace.</p>');
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
            signal?.addEventListener('abort', () => rej(new Error('Aborted')));
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

function randomState(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Public login/silent/logout flows ───

async function login(conn: FnoConnection): Promise<FnoAuthResult> {
  const msal = getMsalApp(conn);
  const scope = buildScope(conn);
  const listener = await startLoopbackListener();
  try {
    const state = randomState();
    const authUrl = await msal.getAuthCodeUrl({
      scopes: [scope],
      redirectUri: listener.redirectUri,
      state,
      prompt: 'select_account',
    });
    console.info('[fno-auth] login starting', {
      tenantId: conn.tenantId,
      clientId: conn.clientId,
      scope,
      redirectUri: listener.redirectUri,
    });
    await shell.openExternal(authUrl);
    const { code } = await listener.waitForCode(state);
    try {
      const tokenResult = await msal.acquireTokenByCode({
        code,
        scopes: [scope],
        redirectUri: listener.redirectUri,
      });
      if (!tokenResult) throw new Error('MSAL returned no token');
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
  const accounts = await msal.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null;
  try {
    const tokenResult = await msal.acquireTokenSilent({
      account: accounts[0],
      scopes: [buildScope(conn)],
    });
    if (!tokenResult) return null;
    return toAuthResult(tokenResult, conn.envUrl);
  } catch {
    return null;
  }
}

async function getAccount(conn: FnoConnection) {
  const msal = getMsalApp(conn);
  const accounts = await msal.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null;
  const a = accounts[0];
  return {
    username: a.username,
    tenantId: a.tenantId,
    homeAccountId: a.homeAccountId,
    name: a.name,
  };
}

async function signOut(conn: FnoConnection): Promise<void> {
  const msal = getMsalApp(conn);
  const accounts = await msal.getTokenCache().getAllAccounts();
  for (const account of accounts) {
    await msal.getTokenCache().removeAccount(account);
  }
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

async function fnoRequest(payload: FnoRequestPayload): Promise<FnoResponsePayload> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: payload.url,
      redirect: 'follow',
    });
    request.setHeader('Authorization', `Bearer ${payload.token}`);
    request.setHeader('Accept', payload.responseType === 'json' ? 'application/json' : 'application/octet-stream, */*');
    const timeout = setTimeout(() => {
      request.abort();
      reject(new Error(`Request timed out after ${payload.timeoutMs ?? 60000}ms: ${payload.url}`));
    }, payload.timeoutMs ?? 60000);

    request.on('response', response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        clearTimeout(timeout);
        const buf = Buffer.concat(chunks);
        const status = response.statusCode;
        const statusText = response.statusMessage ?? '';
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(response.headers ?? {})) {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        if (payload.responseType === 'json') {
          const text = buf.toString('utf-8');
          let json: unknown = undefined;
          try {
            json = text.length > 0 ? JSON.parse(text) : null;
          } catch {
            // not JSON — return bodyText for error messages
          }
          resolve({ status, statusText, headers, json, bodyText: text });
        } else {
          resolve({
            status,
            statusText,
            headers,
            binaryBase64: buf.toString('base64'),
            bodyText: undefined,
          });
        }
      });
      response.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    request.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
    request.end();
  });
}

// ─── IPC registration ───

export function registerFnoIpc(): void {
  ipcMain.handle('fno:auth:login', async (_evt, conn: FnoConnection) => {
    return login(conn);
  });
  ipcMain.handle('fno:auth:silent', async (_evt, conn: FnoConnection) => {
    return acquireSilent(conn);
  });
  ipcMain.handle('fno:auth:account', async (_evt, conn: FnoConnection) => {
    return getAccount(conn);
  });
  ipcMain.handle('fno:auth:logout', async (_evt, conn: FnoConnection) => {
    await signOut(conn);
    return true;
  });
  ipcMain.handle('fno:request', async (_evt, payload: FnoRequestPayload) => {
    return fnoRequest(payload);
  });
}
