import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Its own dedicated key — never BUILD_TOKEN_KEY/PREVIEW_SLUG_KEY — same one-key-per-
 * concern discipline as apps/api's build-token-crypto.ts/preview-slug-crypto.ts.
 */
function loadKey(): Buffer {
  const keyB64 = process.env.PROVISIONING_PROFILE_KEY;
  if (!keyB64) {
    throw new Error('PROVISIONING_PROFILE_KEY is not configured');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('PROVISIONING_PROFILE_KEY must decode to exactly 32 bytes');
  }
  return key;
}

/**
 * Unlike build-token-crypto.ts's string-in/string-out shape, this encrypts the raw
 * .mobileprovision bytes directly (a binary PKCS#7 blob) — no utf8 round-trip. Output
 * is the same iv(12) || ciphertext || authTag(16) base64 blob shape as every other
 * AES-256-GCM secret in this codebase.
 */
export function encryptProvisioningProfile(profileContent: Buffer): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(profileContent), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

export function decryptProvisioningProfile(encoded: string): Buffer {
  const key = loadKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted provisioning profile is malformed');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // GCM's final() throws on a bad auth tag — the same code path catches both a wrong
  // key and a tampered ciphertext, no extra integrity check needed on top.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
