import { createHash } from 'node:crypto';
import { generatePreviewSlug, hashPreviewSlug } from './preview-slug.js';

describe('generatePreviewSlug', () => {
  it('returns a 22-character base64url slug whose hash matches hashPreviewSlug', () => {
    const { rawSlug, slugHash } = generatePreviewSlug();
    expect(rawSlug).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(slugHash).toBe(createHash('sha256').update(rawSlug).digest('hex'));
  });

  it('never repeats a raw slug across calls', () => {
    const a = generatePreviewSlug();
    const b = generatePreviewSlug();
    expect(a.rawSlug).not.toBe(b.rawSlug);
  });
});

describe('hashPreviewSlug', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashPreviewSlug('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});
