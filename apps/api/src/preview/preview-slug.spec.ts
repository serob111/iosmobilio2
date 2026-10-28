import { createHash } from 'node:crypto';
import { generatePreviewSlug, hashPreviewSlug, encodeBase32Lowercase, PREVIEW_SLUG_PATTERN } from './preview-slug.js';

describe('generatePreviewSlug', () => {
  it('returns a 26-character lowercase base32 slug whose hash matches hashPreviewSlug', () => {
    const { rawSlug, slugHash } = generatePreviewSlug();
    expect(rawSlug).toMatch(/^[a-z2-7]{26}$/);
    expect(rawSlug).toMatch(PREVIEW_SLUG_PATTERN);
    expect(slugHash).toBe(createHash('sha256').update(rawSlug).digest('hex'));
  });

  it('is valid as a single DNS label — no uppercase, no "-"/"_", no dots', () => {
    const { rawSlug } = generatePreviewSlug();
    expect(rawSlug).toBe(rawSlug.toLowerCase());
    expect(rawSlug).not.toMatch(/[-_.A-Z]/);
  });

  it('never repeats a raw slug across calls', () => {
    const a = generatePreviewSlug();
    const b = generatePreviewSlug();
    expect(a.rawSlug).not.toBe(b.rawSlug);
  });

});

describe('encodeBase32Lowercase', () => {
  it('matches a known test vector, independently verified via Python\'s base64.b32encode', () => {
    // python3 -c "import base64; print(base64.b32encode(bytes(range(16))).decode().lower().rstrip('='))"
    const bytes = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
    expect(encodeBase32Lowercase(bytes)).toBe('aaaqeayeaudaocajbifqydiob4');
  });

  it('pads a partial final group with zero bits, same as every base32 encoder', () => {
    // 1 byte (8 bits) -> 2 chars (ceil(8/5)): the first 5 bits exactly, then the
    // remaining 3 bits left-shifted into a 5-bit slot with 2 trailing zero bits.
    expect(encodeBase32Lowercase(Buffer.from([0b11111111]))).toBe('74');
  });

  it('always emits exactly ceil(bytes.length * 8 / 5) characters from the [a-z2-7] alphabet', () => {
    for (const length of [0, 1, 2, 5, 16, 20]) {
      const out = encodeBase32Lowercase(Buffer.alloc(length, 0xab));
      expect(out.length).toBe(Math.ceil((length * 8) / 5));
      expect(out).toMatch(/^[a-z2-7]*$/);
    }
  });
});

describe('PREVIEW_SLUG_PATTERN', () => {
  it('rejects the wrong length', () => {
    expect(PREVIEW_SLUG_PATTERN.test('a'.repeat(25))).toBe(false);
    expect(PREVIEW_SLUG_PATTERN.test('a'.repeat(27))).toBe(false);
  });

  it('rejects disallowed characters (uppercase, 0, 1, 8, 9, -, _)', () => {
    for (const bad of ['A'.repeat(26), '0'.repeat(26), '1'.repeat(26), '8'.repeat(26), '9'.repeat(26)]) {
      expect(PREVIEW_SLUG_PATTERN.test(bad)).toBe(false);
    }
    expect(PREVIEW_SLUG_PATTERN.test('a'.repeat(25) + '-')).toBe(false);
  });

  it('accepts exactly 26 lowercase [a-z2-7] characters', () => {
    expect(PREVIEW_SLUG_PATTERN.test('abcdefghijklmnopqrstuvwxyz'.slice(0, 20) + '234567')).toBe(true);
  });
});

describe('hashPreviewSlug', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashPreviewSlug('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});
