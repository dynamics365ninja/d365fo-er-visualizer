/**
 * Cross-navigation marker for the MSAL *redirect* sign-in fallback.
 *
 * The popup flow is unusable on most tablets/mobile browsers, so sign-in falls
 * back to navigating the whole tab to Microsoft identity and back. That reload
 * throws away all React state, so we leave a breadcrumb (the profile id) in
 * sessionStorage — it survives the same-tab round trip — and the connect panel
 * picks it up on mount to finish the sign-in without a second user click.
 */

const PENDING_KEY = 'er-visualizer:fno-redirect-pending';

/**
 * Where Microsoft identity must send the browser back to — and the value that
 * has to be registered in the Entra app registration.
 *
 * This is the plain origin, *not* the `/app` path the SPA is served from. Two
 * reasons:
 *
 *  - It is what the popup flow has always used, so existing registrations keep
 *    working and nobody has to touch Entra to gain tablet support.
 *  - Entra compares redirect URIs verbatim, and a path is one more thing to get
 *    wrong (trailing slash, preview deployments, `/index.html`).
 *
 * On the web deployment the origin is the marketing site, which does not run
 * MSAL — so the site forwards auth responses to `/app` (see the inline script in
 * packages/site/app/layout.tsx). The token request still sends this exact origin
 * as `redirect_uri`, which is what Entra validates.
 *
 * Lives here rather than next to the MSAL adapter so the connect panel can quote
 * it in error messages without pulling ~0.4 MB of identity library into the
 * main bundle.
 */
export function computeRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export function markRedirectPending(connId: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, connId);
  } catch {
    // Private mode / storage disabled: the user just clicks Connect again.
  }
}

/** Profile id of an in-flight redirect sign-in, without clearing the marker. */
export function peekRedirectPending(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearRedirectPending(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}
