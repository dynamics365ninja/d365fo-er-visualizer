/**
 * F&O proxy running on Vercel Edge.
 *
 * Browser SPA cannot call D365 F&O OData directly because F&O does not send
 * CORS headers. This function forwards the request server-side, preserving
 * the caller's bearer token, then returns the response with permissive CORS
 * headers so the SPA can read it.
 *
 * The target URL is passed in the `X-Fno-Target-Url` header. Only hosts that
 * match the F&O SaaS DNS patterns are allowed — this prevents the function
 * from being abused as an open proxy.
 */

export const config = {
  runtime: 'edge',
};

const ALLOWED_HOST_PATTERNS = [
  /^[a-z0-9-]+\.operations\.dynamics\.com$/i,
  /^[a-z0-9-]+\.sandbox\.operations\.dynamics\.com$/i,
  /^[a-z0-9-]+\.cloudax\.dynamics\.com$/i,
  /^[a-z0-9-]+\.sandbox\.ax\.dynamics\.com$/i,
  /^[a-z0-9-]+\.axcloud\.dynamics\.com$/i,
  /^[a-z0-9-]+\.dynamics\.com$/i,
];

function isAllowedTarget(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  return ALLOWED_HOST_PATTERNS.some((re) => re.test(url.hostname));
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Accept, X-Fno-Target-Url, X-Fno-Method',
    'Access-Control-Expose-Headers':
      'Content-Type, Content-Length, X-Fno-Proxy-Upstream-Status, X-Fno-Proxy-Upstream-Location',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
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
    // F&O filters some endpoints by User-Agent. Vercel Edge fetch sends a
    // generic UA (or none), which can cause /api/services/* to respond
    // with 404. Masquerade as a normal browser.
    'User-Agent':
      req.headers.get('user-agent') ??
      'Mozilla/5.0 (compatible; d365fo-er-visualizer-proxy)',
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

  const responseHeaders = new Headers(cors);
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('Content-Type', contentType);
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) responseHeaders.set('Content-Length', contentLength);

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
    return new Response(body, { status: 502, headers: responseHeaders });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
