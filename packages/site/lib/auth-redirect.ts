/**
 * The SPA signs in with MSAL using the plain site origin as its redirect URI —
 * that is the value already registered in existing Entra app registrations, and
 * keeping it means tablet support needs no change on the Entra side.
 *
 * The origin, however, is this marketing site, which never loads MSAL. So when
 * Microsoft identity sends the browser back here with an authorization response,
 * hand it over to the SPA at /app, query string and fragment intact. MSAL there
 * finishes the sign-in via `handleRedirectPromise` and redeems the code with the
 * same origin as `redirect_uri`, which is what Entra validated.
 *
 * Only the *redirect* flow needs this. In the popup flow (desktop) the response
 * lands in a popup that the opener polls, so the popup must be left alone —
 * hence the `window.opener` guard.
 *
 * Runs as a blocking inline script in <head> so the handoff happens before the
 * marketing page paints, rather than flashing content the user did not ask for.
 */
export const authRedirectForwardScript = `(function(){try{
if(window.opener&&window.opener!==window)return;
var p=location.pathname;
if(p==='/app'||p.indexOf('/app/')===0)return;
var q=location.search+location.hash;
if(!/[?#&](code|error)=/.test(q))return;
if(!/[?#&]state=/.test(q))return;
location.replace('/app'+location.search+location.hash);
}catch(e){}})();`;
