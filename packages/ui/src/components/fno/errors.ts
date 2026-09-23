/**
 * User-facing wording for F&O connection and sign-in failures.
 */

import { FnoHttpError } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { computeRedirectUri } from '../../fno/redirect-state';

export function describeHttpError(err: unknown): string {
  if (err instanceof FnoHttpError) {
    const bodyHint = (err.body ?? '').trim().split(/\r?\n/)[0]?.slice(0, 200);
    const suffix = bodyHint ? ` — ${bodyHint}` : '';
    // Our own "no matching operation" error already carries actionable info
    // (tried candidates + available operations discovered from /api/services).
    if (/No matching operation/i.test(err.message)) {
      return `${err.message}${suffix}`;
    }
    if (err.status === 404) {
      const isCustomService = /\/api\/services\//i.test(err.url);
      if (isCustomService) {
        const opMatch = err.url.match(/\/api\/services\/([^/]+)\/([^/]+)\/([^/?#]+)/);
        const [, group, service, op] = opMatch ?? [];
        const serviceUrl = `${err.url.split('/api/services/')[0]}/api/services/${group ?? '<group>'}/${service ?? '<service>'}`;
        return `${t.fnoErrServiceNotFound(err.url, serviceUrl, op ?? '')}${suffix}`;
      }
      return `${t.fnoErrEndpointNotFound(`${err.status} ${err.message} (${err.url})`)}${suffix}`;
    }
    if (err.status === 401 || err.status === 403) {
      return `${t.fnoErrForbidden(`${err.status} ${err.message}`)}${suffix}`;
    }
    return `${err.status} ${err.message} (${err.url})${suffix}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * AADSTS50011 means Entra received a redirect URI that is not on the
 * registration's list. The only useful answer is the exact string it must
 * match — Entra compares verbatim, so a trailing slash or a different host
 * (a Vercel preview deployment has its own) is already a mismatch.
 */
function buildRedirectMismatchMessage(raw: string): string {
  // Entra echoes the offending URI back; prefer it over our own guess.
  const fromServer = raw.match(/redirect URI '([^']+)'/i)?.[1];
  const uri = fromServer || computeRedirectUri();
  const isWeb = /^https?:/i.test(uri);
  return isWeb ? t.fnoErrRedirectWeb(uri) : t.fnoErrRedirectDesktop;
}

export function explainAuthError(err: unknown): string {
  // Unwrap FnoAuthError.cause so we see the *original* MSAL/IPC message.
  const chain: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i += 1) {
    if (current instanceof Error && current.message) chain.push(current.message);
    const next = (current as { cause?: unknown })?.cause;
    if (!next || next === current) break;
    current = next;
  }
  // Electron wraps IPC rejections as:
  //   "Error invoking remote method 'fno:auth:login': Error: <original>"
  // Strip the wrapper so the user sees the real reason.
  const cleaned = chain
    .map(m => m.replace(/^Error invoking remote method '[^']*':\s*Error:\s*/i, ''))
    .filter(Boolean);
  const raw = cleaned.join(' — ') || (err instanceof Error ? err.message : String(err)) || t.fnoUnknownError;

  const code = raw.match(/AADSTS(\d{4,6})/)?.[1];
  switch (code) {
    case '700016':
      return t.fnoErrClientIdUnavailable;
    case '65001':
      return t.fnoErrConsentRequired;
    case '500011':
      return t.fnoErrScopeMismatch;
    case '50020':
      return t.fnoErrWrongTenant;
    case '54005':
    case '9002313':
      return t.fnoErrCodeUsed(code);
    case '50076':
    case '50079':
      return t.fnoErrMfaRequired(code);
    case '7000218':
      return t.fnoErrPublicClientFlows;
    case '9002326':
      return t.fnoErrRedirectIsSpa;
    case '50011':
      return buildRedirectMismatchMessage(raw);
    default:
      return code ? `AADSTS${code}: ${raw}` : raw;
  }
}
