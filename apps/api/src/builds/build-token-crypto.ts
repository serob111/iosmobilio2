import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Only GithubActionsRunner calls this — the build token otherwise never leaves apps/api
 * except through BuildRunner.dispatch(), and encryption is specifically a defense against
 * GitHub Actions' own operational logging/audit surface around workflow_dispatch inputs,
 * not a general property of the BuildRunner interface (a future template-repack runner
 * has no such third-party log exposure and wouldn't need this at all).
 */
function loadKey(): Buffer {
  const keyB64 = process.env.BUILD_TOKEN_KEY;
  if (!keyB64) {
    throw new Error('BUILD_TOKEN_KEY is not configured');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('BUILD_TOKEN_KEY must decode to exactly 32 bytes');
  }
  return key;
}

/** Output is a single base64 blob: iv(12) || ciphertext || authTag(16) — see .github/scripts/decrypt-build-token.mjs for the mirrored decrypt. */
export function encryptBuildToken(rawToken: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

export function decryptBuildToken(encoded: string): string {
  const key = loadKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted build token is malformed');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // GCM's final() throws on a bad auth tag — the same code path catches both a wrong
  // key and a tampered ciphertext, no extra integrity check needed on top.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
