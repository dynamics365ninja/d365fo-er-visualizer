/**
 * F&O HTTP transports — one per host (Electron / Browser).
 *
 * Both implementations conform to `FnoTransport` from @er-visualizer/fno-client.
 */

import type { FnoTransport } from '@er-visualizer/fno-client';
import { FnoHttpError } from '@er-visualizer/fno-client';
import { getElectronApi } from './electron-bridge';

class ElectronFnoTransport implements FnoTransport {
  async getJson<T = unknown>(url: string, token: string, signal?: AbortSignal): Promise<T> {
    const api = getElectronApi();
    if (!api?.fnoRequest) throw new Error('Electron IPC not available');
    signal?.throwIfAborted?.();
    const res = await api.fnoRequest({ url, token, responseType: 'json', timeoutMs: 20_000 });
    signal?.throwIfAborted?.();
    if (res.status < 200 || res.status >= 300) {
      throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, url, res.bodyText);
    }
    return res.json as T;
  }

  async getBinary(url: string, token: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const api = getElectronApi();
    if (!api?.fnoRequest) throw new Error('Electron IPC not available');
    signal?.throwIfAborted?.();
    const res = await api.fnoRequest({ url, token, responseType: 'binary', timeoutMs: 60_000 });
    signal?.throwIfAborted?.();
    if (res.status < 200 || res.status >= 300) {
      throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, url, res.bodyText);
    }
    return base64ToArrayBuffer(res.binaryBase64 ?? '');
  }

  async postJson<T = unknown>(url: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const api = getElectronApi();
    if (!api?.fnoRequest) throw new Error('Electron IPC not available');
    signal?.throwIfAborted?.();
    const res = await api.fnoRequest({
      url,
      token,
      method: 'POST',
      responseType: 'json',
      timeoutMs: 20_000,
      body: JSON.stringify(body ?? {}),
      contentType: 'application/json; charset=utf-8',
    });
    signal?.throwIfAborted?.();
    if (res.status < 200 || res.status >= 300) {
      throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, url, res.bodyText);
    }
    return res.json as T;
  }
}

class BrowserFnoTransport implements FnoTransport {
  /**
   * Browser fetch routed through the Vercel Edge proxy at /api/fno.
   *
   * F&O SaaS OData endpoints do not send CORS headers, so direct calls from
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
    if (!res.ok) {
      const text = await safeText(res);
      throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, url, text);
    }
    return (await res.json()) as T;
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
    if (!res.ok) {
      const text = await safeText(res);
      throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, url, text);
    }
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
    if (!res.ok) {
      const text = await safeText(res);
      throw new FnoHttpError(`${res.status} ${res.statusText}`, res.status, url, text);
    }
    return (await res.json()) as T;
  }
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
