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
