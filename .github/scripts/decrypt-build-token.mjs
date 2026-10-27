#!/usr/bin/env node
// Mirrors apps/api/src/builds/build-token-crypto.ts's encryptBuildToken exactly: a single
// base64 blob of iv(12) || ciphertext || authTag(16), AES-256-GCM. Kept as a standalone,
// dependency-free script (not imported from apps/api) so this workflow never depends on
// the api workspace's build output or module resolution — only BUILD_TOKEN_KEY has to
// match between the two. Reads BUILD_TOKEN_KEY/BUILD_TOKEN_ENC from the environment
// (never from argv or a templated string) and prints only the decrypted token to stdout,
// so the calling step can mask it before it ever touches a log line.
import { createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const keyB64 = process.env.BUILD_TOKEN_KEY;
const encoded = process.env.BUILD_TOKEN_ENC;
if (!keyB64 || !encoded) {
  console.error('BUILD_TOKEN_KEY/BUILD_TOKEN_ENC are not set');
  process.exit(1);
}

const key = Buffer.from(keyB64, 'base64');
if (key.length !== 32) {
  console.error('BUILD_TOKEN_KEY must decode to exactly 32 bytes');
  process.exit(1);
}

const buf = Buffer.from(encoded, 'base64');
if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
  console.error('BUILD_TOKEN_ENC is malformed');
  process.exit(1);
}

const iv = buf.subarray(0, IV_LENGTH);
const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

try {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  process.stdout.write(plaintext.toString('utf8'));
} catch {
  console.error('Failed to decrypt BUILD_TOKEN_ENC (wrong key or tampered ciphertext)');
  process.exit(1);
}
