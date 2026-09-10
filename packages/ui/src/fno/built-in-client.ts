/**
 * The Entra registration this build signs in with.
 *
 * Kept in its own module (like `redirect-state`) so the UI can check it without
 * pulling MSAL into the bundle.
 *
 * Users never see or enter Entra identifiers: a connection profile is just a
 * name and an environment URL, and **Connect** opens the ordinary Microsoft
 * sign-in. That works because sign-in runs against one multi-tenant
 * public-client registration shipped with the app instead of a per-customer
 * one.
 *
 * Set `VITE_FNO_CLIENT_ID` at build time (or fill in `FALLBACK_CLIENT_ID`) with
 * the Application (client) ID of a registration that has:
 *   - Supported account types: accounts in any organizational directory,
 *   - a Single-page application platform listing this build's origins,
 *   - the delegated Dynamics ERP permission `CustomService.FullAccess`.
 */

/**
 * Used when the build defines no `VITE_FNO_CLIENT_ID`.
 *
 * This is the public Application (client) ID of the shipped registration. It is
 * an identifier, not a secret — public clients hold no credentials, and every
 * SPA exposes it in its bundle anyway.
 *
 * Its only Single-page application redirect URI is the production origin
 * `https://d365fo-er-visualizer.vercel.app`. Local development therefore needs
 * `VITE_FNO_CLIENT_ID` pointed at a registration that also lists
 * `http://localhost:5173` — see `.env.example`.
 */
const FALLBACK_CLIENT_ID = '73090c31-37b9-44c1-a8e3-597dae420617';

export const BUILT_IN_CLIENT_ID: string = (
  (import.meta.env.VITE_FNO_CLIENT_ID as string | undefined) ?? FALLBACK_CLIENT_ID
).trim();

/** False only in a misconfigured build — the panel then explains what is missing. */
export const hasBuiltInClientId = BUILT_IN_CLIENT_ID.length > 0;
