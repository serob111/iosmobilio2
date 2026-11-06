import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * A share link's raw slug has to be redisplayable (GET .../preview-link returns the
 * existing active link rather than minting a new one on every page load) — slugHash alone
 * is one-way and can't serve that, so the raw slug is kept, but only as ciphertext, under
 * its own key (not slugHash's sha256, and not BUILD_TOKEN_KEY — a separate secret per
 * separate concern, same reasoning as build-token-crypto.ts's own comment on why that key
 * is scoped to exactly one caller).
 */
function loadKey(): Buffer {
  const keyB64 = process.env.PREVIEW_SLUG_KEY;
  if (!keyB64) {
    throw new Error('PREVIEW_SLUG_KEY is not configured');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('PREVIEW_SLUG_KEY must decode to exactly 32 bytes');
  }
  return key;
}

/** Output is a single base64 blob: iv(12) || ciphertext || authTag(16). */
export function encryptPreviewSlug(rawSlug: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(rawSlug, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

export function decryptPreviewSlug(encoded: string): string {
  const key = loadKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted preview slug is malformed');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
