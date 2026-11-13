import { randomBytes } from 'node:crypto';
import { decryptBuildToken, encryptBuildToken } from './build-token-crypto.js';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

describe('build token encryption (AES-256-GCM)', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('round-trips: decrypting with the same key recovers the exact raw token', () => {
    process.env.BUILD_TOKEN_KEY = KEY_A;
    const encrypted = encryptBuildToken('a'.repeat(64));
    expect(decryptBuildToken(encrypted)).toBe('a'.repeat(64));
  });

  it('produces a different ciphertext every time (random IV), even for the same input', () => {
    process.env.BUILD_TOKEN_KEY = KEY_A;
    const first = encryptBuildToken('same-token');
    const second = encryptBuildToken('same-token');
    expect(first).not.toBe(second);
  });

  it('throws when decrypting with the wrong key', () => {
    process.env.BUILD_TOKEN_KEY = KEY_A;
    const encrypted = encryptBuildToken('secret-token');

    process.env.BUILD_TOKEN_KEY = KEY_B;
    expect(() => decryptBuildToken(encrypted)).toThrow();
  });

  it('throws when the ciphertext has been tampered with', () => {
    process.env.BUILD_TOKEN_KEY = KEY_A;
    const encrypted = encryptBuildToken('secret-token');
    const tampered = Buffer.from(encrypted, 'base64');
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptBuildToken(tampered.toString('base64'))).toThrow();
  });

  it('throws when BUILD_TOKEN_KEY is missing', () => {
    delete process.env.BUILD_TOKEN_KEY;
    expect(() => encryptBuildToken('x')).toThrow(/BUILD_TOKEN_KEY/);
  });

  it('throws when BUILD_TOKEN_KEY does not decode to 32 bytes', () => {
    process.env.BUILD_TOKEN_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptBuildToken('x')).toThrow(/32 bytes/);
  });

  it('throws on a malformed (too-short) ciphertext blob', () => {
    process.env.BUILD_TOKEN_KEY = KEY_A;
    expect(() => decryptBuildToken(Buffer.from('short').toString('base64'))).toThrow(/malformed/);
  });
});
