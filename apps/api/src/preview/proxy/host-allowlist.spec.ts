import { deriveHostAllowlist, isHostAllowed, isUrlHostAllowed } from './host-allowlist.js';

describe('deriveHostAllowlist', () => {
  it('returns null for an unparseable url', () => {
    expect(deriveHostAllowlist('not a url')).toBeNull();
  });

  it('strips a leading www. to get baseHost', () => {
    expect(deriveHostAllowlist('https://www.example.com/')).toEqual({ baseHost: 'example.com' });
  });

  it('keeps a non-www host as-is when there is no leading www.', () => {
    expect(deriveHostAllowlist('https://shop.example.com/menu')).toEqual({ baseHost: 'shop.example.com' });
  });

  it('lowercases the host', () => {
    expect(deriveHostAllowlist('https://EXAMPLE.com/')).toEqual({ baseHost: 'example.com' });
  });

  it('IDN hosts are normalized to punycode, same as the candidate check will be', () => {
    expect(deriveHostAllowlist('https://例え.jp/')).toEqual({ baseHost: 'xn--r8jz45g.jp' });
  });

  it("userinfo in source.url doesn't leak into the base host", () => {
    // Whoever controls source.url controls it anyway (it's the project's own field), but
    // this proves the *parsing* itself isn't confused by userinfo — the real defense
    // against userinfo-smuggling is in proxy-fetch.ts, which rejects it outright.
    expect(deriveHostAllowlist('https://evil.com@site.com/')).toEqual({ baseHost: 'site.com' });
  });

  it('a port in source.url does not become part of the host', () => {
    expect(deriveHostAllowlist('https://example.com:8443/')).toEqual({ baseHost: 'example.com' });
  });
});

describe('isHostAllowed', () => {
  const allowlist = { baseHost: 'example.com' };

  it('allows the exact base host', () => {
    expect(isHostAllowed('example.com', allowlist)).toBe(true);
  });

  it('allows the www variant', () => {
    expect(isHostAllowed('www.example.com', allowlist)).toBe(true);
  });

  it('allows an arbitrary subdomain', () => {
    expect(isHostAllowed('cdn.example.com', allowlist)).toBe(true);
    expect(isHostAllowed('a.b.c.example.com', allowlist)).toBe(true);
  });

  it('rejects a completely different domain', () => {
    expect(isHostAllowed('example.net', allowlist)).toBe(false);
  });

  it('rejects a host that merely ends with the base host as a substring, not a subdomain (suffix confusion)', () => {
    expect(isHostAllowed('notexample.com', allowlist)).toBe(false);
    expect(isHostAllowed('evilexample.com', allowlist)).toBe(false);
  });

  it("rejects a host where the base host is only a prefix (e.g. a sibling that happens to start the same)", () => {
    expect(isHostAllowed('example.com.evil.com', allowlist)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isHostAllowed('CDN.EXAMPLE.COM', allowlist)).toBe(true);
  });

  it('ignores a trailing dot (DNS root label)', () => {
    expect(isHostAllowed('example.com.', allowlist)).toBe(true);
  });

  it("evaluates against the base host of a project at a subdomain narrowly — no sibling access", () => {
    const narrowAllowlist = deriveHostAllowlist('https://shop.example.com/')!;
    expect(isHostAllowed('shop.example.com', narrowAllowlist)).toBe(true);
    expect(isHostAllowed('api.shop.example.com', narrowAllowlist)).toBe(true);
    expect(isHostAllowed('example.com', narrowAllowlist)).toBe(false);
    expect(isHostAllowed('cdn.example.com', narrowAllowlist)).toBe(false);
  });
});

describe('isUrlHostAllowed', () => {
  const allowlist = { baseHost: 'example.com' };

  it('checks a full URL by its hostname, ignoring scheme/path/userinfo', () => {
    expect(isUrlHostAllowed(new URL('https://cdn.example.com/a/b.png'), allowlist)).toBe(true);
    expect(isUrlHostAllowed(new URL('https://evil.com/'), allowlist)).toBe(false);
  });

  it("doesn't let userinfo smuggle a disallowed host past the check", () => {
    // new URL(...).hostname already resolves to the real host (site is disallowed here,
    // example.com claimed in userinfo is irrelevant) — proves the allowlist check itself
    // can't be tricked even if something upstream failed to reject userinfo outright.
    expect(isUrlHostAllowed(new URL('https://example.com@evil.com/'), allowlist)).toBe(false);
  });
});
