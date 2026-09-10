/**
 * The Entra registration the desktop shell signs in with.
 *
 * Users never see or enter Entra identifiers — a connection profile is just a
 * name and an environment URL. Sign-in runs against this one multi-tenant
 * public-client registration, so the customer does not have to create an app
 * registration of their own.
 *
 * Fill in `FALLBACK_CLIENT_ID` (or set `FNO_CLIENT_ID` in the environment,
 * which wins) with the Application (client) ID of a registration that has:
 *   - Supported account types: accounts in any organizational directory,
 *   - a "Mobile and desktop applications" platform with `http://localhost`,
 *   - "Allow public client flows" = Yes,
 *   - the delegated Dynamics ERP permission `CustomService.FullAccess`.
 */

/**
 * Baked into packaged builds, which have no useful environment. This is the
 * public Application (client) ID of the shipped registration — an identifier,
 * not a secret, since public clients hold no credentials.
 */
const FALLBACK_CLIENT_ID = '73090c31-37b9-44c1-a8e3-597dae420617';

export const BUILT_IN_CLIENT_ID: string = (
  process.env.FNO_CLIENT_ID ?? FALLBACK_CLIENT_ID
).trim();

/**
 * Authority tenant used for every sign-in. `organizations` lets the user pick
 * whichever work/school account they have; the real tenant comes back on the
 * token, so nothing has to be configured per environment.
 */
export const AUTHORITY_TENANT = 'organizations';
