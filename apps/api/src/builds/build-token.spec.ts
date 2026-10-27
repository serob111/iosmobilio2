import { createHash } from 'node:crypto';
import { generateBuildToken, hashBuildToken } from './build-token.js';

describe('generateBuildToken', () => {
  it('returns a raw token whose sha256 hash matches tokenHash, and a 2-hour expiry', () => {
    const before = Date.now();
    const { rawToken, tokenHash, expiresAt } = generateBuildToken();

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(expiresAt.getTime()).toBeGreaterThan(before + 2 * 60 * 60 * 1000 - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(before + 2 * 60 * 60 * 1000 + 1000);
  });

  it('never repeats a raw token across calls', () => {
    const a = generateBuildToken();
    const b = generateBuildToken();
    expect(a.rawToken).not.toBe(b.rawToken);
  });
});

describe('hashBuildToken', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashBuildToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});
