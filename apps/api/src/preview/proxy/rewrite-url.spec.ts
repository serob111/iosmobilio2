import { buildProxyPath, rewriteReferencedUrl, HOST_OVERRIDE_QUERY_KEY } from './rewrite-url.js';

const ALLOWLIST = { baseHost: 'example.com' };
const PRIMARY_HOST = 'example.com';
const PAGE_URL = new URL('https://example.com/dir/page.html');

describe('buildProxyPath', () => {
  it('builds a bare proxy path for the primary host', () => {
    expect(buildProxyPath('slug1', new URL('https://example.com/a/b'), PRIMARY_HOST)).toBe('/s/slug1/a/b');
  });

  it('preserves query and hash for the primary host', () => {
    expect(buildProxyPath('slug1', new URL('https://example.com/a?x=1#y'), PRIMARY_HOST)).toBe(
      '/s/slug1/a?x=1#y',
    );
  });

  it('appends the host-override query param for a non-primary allowed host with no existing query', () => {
    expect(buildProxyPath('slug1', new URL('https://cdn.example.com/a'), PRIMARY_HOST)).toBe(
      `/s/slug1/a?${HOST_OVERRIDE_QUERY_KEY}=cdn.example.com`,
    );
  });

  it('appends the host-override query param with & when a query already exists', () => {
    expect(buildProxyPath('slug1', new URL('https://cdn.example.com/a?x=1'), PRIMARY_HOST)).toBe(
      `/s/slug1/a?x=1&${HOST_OVERRIDE_QUERY_KEY}=cdn.example.com`,
    );
  });
});

describe('rewriteReferencedUrl', () => {
  it('leaves a malformed URL untouched', () => {
    expect(rewriteReferencedUrl('http://[::1', PAGE_URL, ALLOWLIST, 'slug1', PRIMARY_HOST)).toBe('http://[::1');
  });

  it('leaves javascript: untouched', () => {
    const raw = 'javascript:void(0)';
    expect(rewriteReferencedUrl(raw, PAGE_URL, ALLOWLIST, 'slug1', PRIMARY_HOST)).toBe(raw);
  });

  it('leaves data: untouched', () => {
    const raw = 'data:image/png;base64,abcd';
    expect(rewriteReferencedUrl(raw, PAGE_URL, ALLOWLIST, 'slug1', PRIMARY_HOST)).toBe(raw);
  });

  it('resolves a relative path against the current page URL', () => {
    expect(rewriteReferencedUrl('../other.html', PAGE_URL, ALLOWLIST, 'slug1', PRIMARY_HOST)).toBe(
      '/s/slug1/other.html',
    );
  });

  it('leaves a disallowed absolute host untouched', () => {
    const raw = 'https://evil.com/x';
    expect(rewriteReferencedUrl(raw, PAGE_URL, ALLOWLIST, 'slug1', PRIMARY_HOST)).toBe(raw);
  });
});
