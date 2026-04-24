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
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
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
      redirect: 'follow',
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

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
