import { FnoAuthError, type FnoConnection } from './types';

/**
 * Authority tenant segment used when a profile carries no explicit tenant.
 *
 * `organizations` lets a multi-tenant app registration sign the user into
 * whatever work/school tenant they pick, so the profile only needs `envUrl`.
 * The real tenant comes back on the token and is surfaced through
 * `AuthResult.account.tenantId`.
 */
export const DEFAULT_AUTHORITY_TENANT = 'organizations';

/**
 * Build the MSAL scope for a given F&O environment.
 *
 * F&O issues access tokens with resource == env host (without a trailing slash).
 * The modern MSAL scope equivalent is `${envUrl}/.default`.
 */
export function buildFnoScope(conn: FnoConnection): string {
  const trimmed = conn.envUrl.replace(/\/+$/, '');
  return `${trimmed}/.default`;
}

/**
 * Build the Entra authority URL for a tenant.
 * Accepts either a GUID or a verified domain.
 *
 * When `tenantId` is empty the shared `organizations` authority is used, which
 * is what makes a URL-only profile work against a multi-tenant registration.
 */
export function buildAuthority(tenantId?: string): string {
  const tenant = (tenantId ?? '').trim() || DEFAULT_AUTHORITY_TENANT;
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
}

/**
 * Resolve the Entra application (client) id to sign in with.
 *
 * A profile-level `clientId` always wins — that is the escape hatch for
 * customers who must use their own registration (e.g. Conditional Access
 * policies scoped to a specific app). Otherwise the host's built-in
 * multi-tenant registration is used, so the user only ever types an
 * environment URL.
 */
export function resolveClientId(conn: FnoConnection, fallbackClientId?: string): string {
  const explicit = (conn.clientId ?? '').trim();
  if (explicit) return explicit;
  const fallback = (fallbackClientId ?? '').trim();
  if (fallback) return fallback;
  throw new FnoAuthError(
    'No Entra application (client) ID available. This build has no built-in ' +
      'registration configured, so the connection profile must supply its own ' +
      'Application (client) ID under Advanced settings.',
  );
}

/**
 * Stable cache key for one (tenant, client) sign-in context. Profiles that
 * omit both fields and rely on the built-in registration share a single key,
 * which is what lets a second environment reuse the first sign-in silently.
 */
export function authContextKey(conn: FnoConnection, fallbackClientId?: string): string {
  const tenant = (conn.tenantId ?? '').trim() || DEFAULT_AUTHORITY_TENANT;
  const client = (conn.clientId ?? '').trim() || (fallbackClientId ?? '').trim();
  return `${tenant}::${client}`;
}

