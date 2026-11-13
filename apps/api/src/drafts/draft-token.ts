import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response } from 'express';

export const DRAFT_COOKIE_NAME = 'mobilio_draft_token';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashDraftToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function generateDraftToken(): { rawToken: string; tokenHash: string; expiresAt: Date } {
  const rawToken = randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashDraftToken(rawToken), expiresAt: new Date(Date.now() + DRAFT_TTL_MS) };
}

/**
 * Defaults to secure (HTTPS-only) — COOKIE_SECURE must be explicitly set to "false" to
 * opt out, which is only ever correct for local dev over plain http. Getting this
 * backwards (defaulting to insecure) would mean a forgotten/missing env var silently
 * ships a cookie that can leak over plain HTTP in prod.
 */
function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE !== 'false';
}

/** clearDraftCookie must pass the same attributes used to set the cookie — path (and, for
 * some browsers, secure/sameSite) is part of how a Set-Cookie is matched for deletion;
 * passing a different set of attributes can leave the original cookie not actually cleared. */
function cookieOptions(): { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/' } {
  return { httpOnly: true, secure: cookieSecure(), sameSite: 'lax', path: '/' };
}

export function setDraftCookie(res: Response, rawToken: string): void {
  res.cookie(DRAFT_COOKIE_NAME, rawToken, { ...cookieOptions(), maxAge: DRAFT_TTL_MS });
}

export function clearDraftCookie(res: Response): void {
  res.clearCookie(DRAFT_COOKIE_NAME, cookieOptions());
}

/**
 * No cookie-parser middleware is mounted in this app (see create-app.ts) — Better Auth
 * reads the raw Cookie header itself, so nothing else here has ever needed one. A
 * hand-rolled parse of just this one cookie name avoids adding a dependency for a single
 * read.
 */
export function readDraftCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    if (part.slice(0, eqIndex).trim() === DRAFT_COOKIE_NAME) {
      // A malformed %-escape (e.g. a bare "%" or a truncated "%2") throws from
      // decodeURIComponent — treated the same as "no cookie" (DraftGuard 404s) rather
      // than crashing the request with an unhandled error.
      try {
        return decodeURIComponent(part.slice(eqIndex + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
