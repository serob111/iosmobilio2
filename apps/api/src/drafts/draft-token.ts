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

export function setDraftCookie(res: Response, rawToken: string): void {
  res.cookie(DRAFT_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: DRAFT_TTL_MS,
    path: '/',
  });
}

export function clearDraftCookie(res: Response): void {
  res.clearCookie(DRAFT_COOKIE_NAME, { path: '/' });
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
      return decodeURIComponent(part.slice(eqIndex + 1).trim());
    }
  }
  return undefined;
}
