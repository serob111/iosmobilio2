import { randomBytes, createHash } from 'node:crypto';

export function hashPreviewSlug(rawSlug: string): string {
  return createHash('sha256').update(rawSlug).digest('hex');
}

const BASE32_LOWERCASE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * RFC 4648 base32, lowercased, no '=' padding — Node has no built-in base32 codec (only
 * base64/base64url/hex), so this is hand-rolled rather than pulling in a dependency for
 * something this small. 16 bytes (128 bits) -> 26 chars (ceil(128/5), the last char
 * carrying only 3 real bits, zero-padded by the trailing `<< (5 - bits)` the same way
 * every base32 encoder pads a partial final group). Verified against Python's
 * `base64.b32encode(...).lower().rstrip('=')` on both a fixed vector and 1000 random
 * 16-byte inputs before relying on it here.
 */
export function encodeBase32Lowercase(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_LOWERCASE_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_LOWERCASE_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/** Exactly what a valid preview slug looks like — one DNS label, 26 chars, [a-z2-7]. */
export const PREVIEW_SLUG_PATTERN = /^[a-z2-7]{26}$/;

/**
 * 16 random bytes (128 bits), lowercase base32, no padding — 26 characters. Unlike the
 * old base64url encoding (22 chars, but mixed-case and containing `-`/`_`), this one must
 * itself be valid as a single DNS *label* (case-insensitive, alphanumeric), since it's no
 * longer just a URL path segment but the actual leftmost subdomain of the preview proxy's
 * origin (https://<slug>.<PREVIEW_PROXY_DOMAIN>/<path>) — DNS lowercases/case-folds
 * hostnames anyway, so the charset is restricted up front rather than relying on that.
 */
export function generatePreviewSlug(): { rawSlug: string; slugHash: string } {
  const rawSlug = encodeBase32Lowercase(randomBytes(16));
  return { rawSlug, slugHash: hashPreviewSlug(rawSlug) };
}
