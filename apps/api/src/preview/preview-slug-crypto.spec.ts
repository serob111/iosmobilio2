import { randomBytes } from 'node:crypto';
import { encryptPreviewSlug, decryptPreviewSlug } from './preview-slug-crypto.js';

describe('preview-slug-crypto', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  beforeEach(() => {
    process.env.PREVIEW_SLUG_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips a raw slug through encrypt/decrypt', () => {
    const encrypted = encryptPreviewSlug('abc123XYZ_-');
    expect(decryptPreviewSlug(encrypted)).toBe('abc123XYZ_-');
  });

  it('throws when PREVIEW_SLUG_KEY is not configured', () => {
    delete process.env.PREVIEW_SLUG_KEY;
    expect(() => encryptPreviewSlug('slug')).toThrow(/PREVIEW_SLUG_KEY is not configured/);
  });

  it('throws when PREVIEW_SLUG_KEY does not decode to exactly 32 bytes', () => {
    process.env.PREVIEW_SLUG_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptPreviewSlug('slug')).toThrow(/32 bytes/);
  });

  it('throws decrypting a malformed (too-short) ciphertext', () => {
    expect(() => decryptPreviewSlug(Buffer.alloc(10, 1).toString('base64'))).toThrow(/malformed/);
  });

  it('throws decrypting a ciphertext that was encrypted under a different key (auth tag mismatch)', () => {
    const encrypted = encryptPreviewSlug('slug');
    process.env.PREVIEW_SLUG_KEY = randomBytes(32).toString('base64');
    expect(() => decryptPreviewSlug(encrypted)).toThrow();
  });
});
