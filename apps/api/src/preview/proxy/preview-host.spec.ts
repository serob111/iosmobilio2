import { extractPreviewSlugFromHost, isWithinPreviewProxyDomain } from './preview-host.js';

const DOMAIN = 'usercontent-preview.example';
const VALID_SLUG = 'abcdefghijklmnopqrstuvwxyz'.slice(0, 20) + '234567'; // 26 chars, [a-z2-7]

describe('extractPreviewSlugFromHost', () => {
  it('extracts a well-formed slug subdomain', () => {
    expect(extractPreviewSlugFromHost(`${VALID_SLUG}.${DOMAIN}`, DOMAIN)).toBe(VALID_SLUG);
  });

  it('ignores a port on the Host header', () => {
    expect(extractPreviewSlugFromHost(`${VALID_SLUG}.${DOMAIN}:3011`, DOMAIN)).toBe(VALID_SLUG);
  });

  it('is case-insensitive (DNS hostnames are)', () => {
    expect(extractPreviewSlugFromHost(`${VALID_SLUG.toUpperCase()}.${DOMAIN}`, DOMAIN)).toBe(VALID_SLUG);
  });

  it('returns null for the bare proxy domain with no slug subdomain', () => {
    expect(extractPreviewSlugFromHost(DOMAIN, DOMAIN)).toBeNull();
  });

  it('returns null for a host entirely outside the proxy domain', () => {
    expect(extractPreviewSlugFromHost(`${VALID_SLUG}.evil.example`, DOMAIN)).toBeNull();
  });

  it('returns null for a nested subdomain (a.<slug>.domain)', () => {
    expect(extractPreviewSlugFromHost(`a.${VALID_SLUG}.${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it('returns null for a forged Host containing an embedded dot inside what would be the label', () => {
    expect(extractPreviewSlugFromHost(`evil.com.${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it('returns null for a slug of the wrong length (too short)', () => {
    expect(extractPreviewSlugFromHost(`${VALID_SLUG.slice(0, 25)}.${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it('returns null for a slug of the wrong length (too long)', () => {
    expect(extractPreviewSlugFromHost(`${VALID_SLUG}a.${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it('returns null for a slug with disallowed characters (0, 1, 8, 9, -, _)', () => {
    expect(extractPreviewSlugFromHost(`${'0'.repeat(26)}.${DOMAIN}`, DOMAIN)).toBeNull();
    expect(extractPreviewSlugFromHost(`${VALID_SLUG.slice(0, 25)}-.${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it('returns null for an IDN/punycode label (starts with "xn--", contains "-")', () => {
    // "例え.jp"-style label punycode-encodes to something starting with xn-- — the
    // leading "xn--" and embedded hyphen alone already fail PREVIEW_SLUG_PATTERN, so
    // this never needs special IDN-specific handling.
    expect(extractPreviewSlugFromHost(`xn--r8jz45g.${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it('returns null for a malformed Host header', () => {
    expect(extractPreviewSlugFromHost('http://[::1', DOMAIN)).toBeNull();
  });

  it('returns null for an undefined Host header', () => {
    expect(extractPreviewSlugFromHost(undefined, DOMAIN)).toBeNull();
  });

  it('returns null for a Host with a trailing dot (absolute-FQDN form)', () => {
    expect(extractPreviewSlugFromHost(`${VALID_SLUG}.${DOMAIN}.`, DOMAIN)).toBeNull();
  });
});

describe('isWithinPreviewProxyDomain', () => {
  it('is true for the bare domain', () => {
    expect(isWithinPreviewProxyDomain(DOMAIN, DOMAIN)).toBe(true);
  });

  it('is true for any subdomain, slug-shaped or not', () => {
    expect(isWithinPreviewProxyDomain(`${VALID_SLUG}.${DOMAIN}`, DOMAIN)).toBe(true);
    expect(isWithinPreviewProxyDomain(`not-a-valid-slug.${DOMAIN}`, DOMAIN)).toBe(true);
    expect(isWithinPreviewProxyDomain(`a.${VALID_SLUG}.${DOMAIN}`, DOMAIN)).toBe(true);
  });

  it('is false for a host outside the domain', () => {
    expect(isWithinPreviewProxyDomain('app.mobilio.example', DOMAIN)).toBe(false);
  });

  it('is false for a different domain that merely shares a suffix string', () => {
    expect(isWithinPreviewProxyDomain(`notusercontent-preview.example`, DOMAIN)).toBe(false);
  });
});
