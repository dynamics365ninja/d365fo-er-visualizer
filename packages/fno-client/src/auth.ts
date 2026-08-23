import type { FnoConnection } from './types';

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
 */
export function buildAuthority(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`;
}

