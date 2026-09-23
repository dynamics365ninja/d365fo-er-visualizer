/**
 * F&O HTTP transports — one per host (Electron / Browser).
 *
 * Both implementations conform to `FnoTransport` from @er-visualizer/fno-client.
 */

import type { FnoTransport } from '@er-visualizer/fno-client';
import { FnoHttpError, parseJsonResponseText } from '@er-visualizer/fno-client';
import { getElectronApi, type ElectronFnoRequest, type ElectronFnoResponse } from './electron-bridge';

/**
 * Both transports report failures the same way: non-2xx is an `FnoHttpError`
 * carrying the body (an upstream redirect arrives as the 502 both the web
 * proxy and the Electron main process synthesize), and a 2xx body that should
 * be JSON but is not goes through `parseJsonResponseText` — so a sign-in page
 * served with 200 is an auth error on either host, never "empty content".
 */

function newRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

class ElectronFnoTransport implements FnoTransport {
  /**
   * One IPC round trip. The request carries an id so an abort of `signal`
   * cancels the `net.request` in the main process rather than leaving it to
   * run to completion.
   */
  private async send(payload: Omit<ElectronFnoRequest, 'requestId'>, signal?: AbortSignal): Promise<ElectronFnoResponse> {
    const api = getElectronApi();
    if (!api?.fnoRequest) throw new Error('Electron IPC not available');
    signal?.throwIfAborted?.();
    const requestId = newRequestId();
    const onAbort = () => api.fnoAbort?.(requestId);
    signal?.addEventListener('abort', onAbort, { once: true });
    let res: ElectronFnoResponse;
    try {
      res = await api.fnoRequest({ ...payload, requestId });
    } catch (err) {
      // An aborted request comes back as a generic IPC error; report the
      // caller's abort reason instead.
      signal?.throwIfAborted?.();
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.throwIfAborted?.();
    if (res.status < 200 || res.status >= 300) {
      throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, payload.url, res.bodyText, res.headers);
    }
    return res;
  }

  private json<T>(res: ElectronFnoResponse, url: string): T {
    if (res.json !== undefined) return res.json as T;
    return parseJsonResponseText(res.bodyText ?? '', url, res.status) as T;
  }

  async getJson<T = unknown>(url: string, token: string, signal?: AbortSignal): Promise<T> {
    const res = await this.send({ url, token, responseType: 'json', timeoutMs: 20_000 }, signal);
    return this.json<T>(res, url);
  }

  async getBinary(url: string, token: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await this.send({ url, token, responseType: 'binary', timeoutMs: 60_000 }, signal);
    return base64ToArrayBuffer(res.binaryBase64 ?? '');
  }

  async postJson<T = unknown>(url: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.send(
      {
        url,
        token,
        method: 'POST',
        responseType: 'json',
        timeoutMs: 20_000,
        body: JSON.stringify(body ?? {}),
        contentType: 'application/json; charset=utf-8',
      },
      signal,
    );
    return this.json<T>(res, url);
  }
}

class BrowserFnoTransport implements FnoTransport {
  /**
   * Browser fetch routed through the Vercel Edge proxy at /api/fno.
   *
   * F&O SaaS endpoints do not send CORS headers, so direct calls from
   * a web origin are blocked. The proxy forwards the bearer token and target
   * URL server-side and returns the response with permissive CORS headers.
   *
   * In Electron we never land here — ElectronFnoTransport is selected instead.
   */
  private readonly proxyUrl = '/api/fno';

  async getJson<T = unknown>(url: string, token: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(this.proxyUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Fno-Target-Url': url,
        'X-Fno-Method': 'GET',
      },
      signal,
      credentials: 'omit',
    });
    await throwIfNotOk(res, url);
    return parseJsonResponseText(await res.text(), url, res.status) as T;
  }

  async getBinary(url: string, token: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await fetch(this.proxyUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/octet-stream, */*',
        'X-Fno-Target-Url': url,
        'X-Fno-Method': 'GET',
      },
      signal,
      credentials: 'omit',
    });
    await throwIfNotOk(res, url);
    return await res.arrayBuffer();
  }

  async postJson<T = unknown>(url: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Fno-Target-Url': url,
        'X-Fno-Method': 'POST',
      },
      body: JSON.stringify(body ?? {}),
      signal,
      credentials: 'omit',
    });
    await throwIfNotOk(res, url);
    return parseJsonResponseText(await res.text(), url, res.status) as T;
  }
}

/** Non-2xx → `FnoHttpError` with the body and the headers retry logic reads. */
async function throwIfNotOk(res: Response, url: string): Promise<void> {
  if (res.ok) return;
  const text = await safeText(res);
  const headers: Record<string, string> = {};
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) headers['retry-after'] = retryAfter;
  throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, url, text, headers);
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Pick the right transport at runtime. */
export function createFnoTransport(): FnoTransport {
  const api = getElectronApi();
  if (api?.fnoRequest) return new ElectronFnoTransport();
  return new BrowserFnoTransport();
}
