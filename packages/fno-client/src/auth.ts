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

/**
 * Default redirect URI for Electron desktop: loopback on an ephemeral port.
 * The actual port is decided at login time; this is only the host prefix.
 */
export const ELECTRON_LOOPBACK_HOST = 'http://localhost';

/**
 * Default redirect URI for browser SPA: the current origin + path.
 * Caller can override via profile later.
 */
export function defaultBrowserRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/`;
}
