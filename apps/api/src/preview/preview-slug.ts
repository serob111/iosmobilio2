import { randomBytes, createHash } from 'node:crypto';

export function hashPreviewSlug(rawSlug: string): string {
  return createHash('sha256').update(rawSlug).digest('hex');
}

/**
 * 16 random bytes, base64url (no padding) — 22 characters, URL-safe as-is. Unlike
 * drafts'/builds' tokens (hex, delivered via a cookie or a workflow input, never
 * displayed), this one IS the thing a human reads/types/scans as a QR code, so a short,
 * URL-safe encoding matters here in a way it doesn't for those.
 */
export function generatePreviewSlug(): { rawSlug: string; slugHash: string } {
  const rawSlug = randomBytes(16).toString('base64url');
  return { rawSlug, slugHash: hashPreviewSlug(rawSlug) };
}
