/**
 * F&O proxy running on the edge.
 *
 * The browser SPA cannot call D365 F&O directly because F&O does not send
 * CORS headers. This handler forwards the request server-side, preserving
 * the caller's bearer token, then returns the response with CORS headers
 * scoped to the site's own origin (plus `FNO_PROXY_ALLOWED_ORIGINS`) so the
 * SPA can read it.
 *
 * The target URL is passed in the `X-Fno-Target-Url` header. Only hosts that
 * match the F&O SaaS DNS patterns are allowed — this prevents the function
 * from being abused as an open proxy. Callers are checked server-side too:
 * a browser request from a foreign origin is refused outright rather than
 * merely left unreadable by CORS. Nothing is logged or stored: the upstream
 * body is streamed straight back to the caller.
 */

export const runtime = 'edge';

/**
 * F&O environment hosts — not the whole of *.dynamics.com, which also serves
 * Dataverse/CRM and other products the SPA never talks to:
 *   - `<env>.operations.dynamics.com`, `<env>.sandbox.operations.dynamics.com`
 *     and their regional forms (`<env>.operations.eu.dynamics.com`,
 *     `<env>.sandbox.operations.eu.dynamics.com`, …),
 *   - cloud-hosted / legacy AX7 hosts: `<env>.cloudax.dynamics.com`,
 *     `<env>.axcloud.dynamics.com`, `<env>.sandbox.ax.dynamics.com`.
 * Keep in sync with packages/electron/src/fno/ipc.ts (which additionally
 * allows `cloud.onebox` dev VMs — reachable only from the VM, never from here).
 */
const ALLOWED_HOST_PATTERNS = [
  /^(?:[a-z0-9-]+\.)+operations(?:\.[a-z]{2,8})?\.dynamics\.com$/i,
  /^(?:[a-z0-9-]+\.)+(?:cloudax|axcloud|sandbox\.ax)\.dynamics\.com$/i,
];

function isAllowedTarget(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  // No credentials or non-default port smuggled into the target.
  if (url.username || url.password || url.port) return false;
  return ALLOWED_HOST_PATTERNS.some((re) => re.test(url.hostname));
}

/**
 * Origins allowed to call the proxy from a browser. The site's own origin is
 * always allowed; additional origins (e.g. the Vite dev server, a preview
 * deployment) come from the comma-separated `FNO_PROXY_ALLOWED_ORIGINS` env.
 */
function extraAllowedOrigins(): string[] {
  return (process.env.FNO_PROXY_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
}

function isAllowedOrigin(origin: string | null, selfOrigin: string): origin is string {
  if (!origin) return false;
  const normalized = origin.replace(/\/+$/, '');
  return normalized === selfOrigin || extraAllowedOrigins().includes(normalized);
}

/**
 * Server-side caller check. CORS only stops a foreign page from *reading* the
 * response; the upstream call would still be made. So:
 *   - an `Origin` header, when present, must be allowed;
 *   - `Sec-Fetch-Site`, when present (every current browser sends it), must be
 *     `same-origin`, or `cross-site`/`same-site` from an allowed origin. `none`
 *     is a user typing the URL — never how the SPA calls the proxy.
 * Non-browser callers send neither header and still have to present a bearer
 * token F&O accepts, so they gain nothing they could not do directly.
 */
function isAllowedCaller(req: Request, selfOrigin: string): boolean {
  const origin = req.headers.get('origin');
  const originOk = origin === null || isAllowedOrigin(origin, selfOrigin);
  if (!originOk) return false;
  const site = req.headers.get('sec-fetch-site');
  if (site === null || site === 'same-origin') return true;
  return isAllowedOrigin(origin, selfOrigin);
}

/**
 * Same-origin requests (the staged SPA under /app) carry no `Origin` header on
 * GET and need no ACAO at all; cross-origin callers get ACAO only when their
 * origin is allowed. Preflight still answers with the method/header grants so
 * the browser can report a clean CORS failure instead of a network error.
 */
function corsHeaders(origin: string | null, selfOrigin: string): Record<string, string> {
  return {
    ...(isAllowedOrigin(origin, selfOrigin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Accept, X-Fno-Target-Url, X-Fno-Method',
    'Access-Control-Expose-Headers':
      'Content-Type, Retry-After, X-Fno-Proxy-Upstream-Status, X-Fno-Proxy-Upstream-Location',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    // Responses carry tenant data fetched with the caller's token: never cache
    // them anywhere, and never let a browser sniff them into something else.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const selfOrigin = new URL(req.url).origin;
  const cors = corsHeaders(origin, selfOrigin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!isAllowedCaller(req, selfOrigin)) {
    return new Response('Caller origin not allowed', { status: 403, headers: cors });
  }

  const targetHeader = req.headers.get('x-fno-target-url');
  if (!targetHeader) {
    return new Response('Missing X-Fno-Target-Url header', {
      status: 400,
      headers: cors,
    });
  }

  let target: URL;
  try {
    target = new URL(targetHeader);
  } catch {
    return new Response('Invalid X-Fno-Target-Url', { status: 400, headers: cors });
  }

  if (!isAllowedTarget(target)) {
    return new Response(`Target host not allowed: ${target.hostname}`, {
      status: 403,
      headers: cors,
    });
  }

  const authorization = req.headers.get('authorization');
  if (!authorization) {
    return new Response('Missing Authorization header', { status: 401, headers: cors });
  }

  const method = (req.headers.get('x-fno-method') ?? req.method).toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return new Response('Unsupported method', { status: 405, headers: cors });
  }

  const forwardedHeaders: Record<string, string> = {
    Authorization: authorization,
    Accept: req.headers.get('accept') ?? 'application/json',
    // F&O filters some endpoints by User-Agent. Edge fetch sends a generic UA
    // (or none), which can cause /api/services/* to respond with 404.
    // Masquerade as a normal browser.
    'User-Agent':
      req.headers.get('user-agent') ?? 'Mozilla/5.0 (compatible; d365fo-er-visualizer-proxy)',
  };
  if (method === 'POST') {
    forwardedHeaders['Content-Type'] =
      req.headers.get('content-type') ?? 'application/json; charset=utf-8';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method,
      headers: forwardedHeaders,
      body: method === 'POST' ? await req.arrayBuffer() : undefined,
      // Do NOT follow redirects: cross-origin redirects strip the
      // Authorization header and we end up on the login page. Surface
      // the redirect to the caller so they can see what's happening.
      redirect: 'manual',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'upstream fetch failed';
    return new Response(`Upstream error: ${msg}`, { status: 502, headers: cors });
  }

  // Only the content type is forwarded. `fetch` already decompressed the
  // upstream body, so its `Content-Length` / `Content-Encoding` would describe
  // the wire form and corrupt the response; the runtime recomputes both.
  const responseHeaders = new Headers(cors);

  // Diagnostic headers — visible in browser DevTools Network panel.
  responseHeaders.set('X-Fno-Proxy-Upstream-Status', String(upstream.status));
  const location = upstream.headers.get('location');
  if (location) responseHeaders.set('X-Fno-Proxy-Upstream-Location', location);

  // Surface redirect responses as a descriptive 502 instead of silently
  // following them (where Authorization would be dropped).
  if (upstream.status >= 300 && upstream.status < 400 && location) {
    const body =
      `Upstream F&O redirected (${upstream.status}) to ${location}.\n` +
      `This usually means the access token was rejected and F&O issued a ` +
      `login redirect. Check tenantId, clientId, and that the token audience ` +
      `matches envUrl.`;
    responseHeaders.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(body, { status: 502, headers: responseHeaders });
  }

  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('Content-Type', contentType);
  // Lets the client honour F&O throttling (429/503) instead of guessing.
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) responseHeaders.set('Retry-After', retryAfter);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
