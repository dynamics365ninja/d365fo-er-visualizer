import { FnoHttpError } from './types';

/**
 * Shared response handling for the host transports (Electron IPC and the
 * browser proxy), so both report the same failure the same way.
 */

/**
 * Status and text the transports use for an upstream 3xx. The web proxy
 * (packages/site/app/api/fno/route.ts) answers 502 with this wording; the
 * Electron main process synthesizes the same response instead of following
 * the redirect.
 */
export const UPSTREAM_REDIRECT_STATUS = 502;

export function describeUpstreamRedirect(status: number, location: string): string {
  return (
    `Upstream F&O redirected (${status}) to ${location}.\n` +
    `This usually means the access token was rejected and F&O issued a ` +
    `login redirect. Check tenantId, clientId, and that the token audience ` +
    `matches envUrl.`
  );
}

/**
 * Parse a 2xx body that is supposed to be JSON.
 *
 * An empty body is `null` (F&O answers some accepted-but-empty service calls
 * that way). A body that is not JSON is never passed on as "no content": an
 * HTML page is almost always the sign-in page F&O serves when it does not
 * accept the token, so it becomes a 401 the UI already treats as "sign in
 * again"; anything else is a 502.
 */
export function parseJsonResponseText(text: string, url: string, status: number): unknown {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const excerpt = trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
    if (/^<(!doctype\s+html|html[\s>])/i.test(trimmed)) {
      throw new FnoHttpError(
        `F&O returned an HTML page (HTTP ${status}) instead of JSON. This is usually ` +
          `the sign-in page, meaning the access token was not accepted — sign in again.`,
        401,
        url,
        excerpt,
      );
    }
    throw new FnoHttpError(
      `F&O returned a response (HTTP ${status}) that is not valid JSON.`,
      502,
      url,
      excerpt,
    );
  }
}
