import { rewriteCss, type CssRewriterOptions } from './css-rewriter.js';

function baseOptions(overrides: Partial<CssRewriterOptions> = {}): CssRewriterOptions {
  return {
    allowlist: { baseHost: 'example.com' },
    currentPageUrl: new URL('https://example.com/styles/main.css'),
    primaryHost: 'example.com',
    ...overrides,
  };
}

describe('rewriteCss', () => {
  it('rewrites a double-quoted url() on an allowed host into a bare path-absolute reference', () => {
    const out = rewriteCss('a{background:url("https://example.com/bg.png")}', baseOptions());
    expect(out).toBe('a{background:url("/bg.png")}');
  });

  it('rewrites a single-quoted url()', () => {
    const out = rewriteCss("a{background:url('https://example.com/bg.png')}", baseOptions());
    expect(out).toBe("a{background:url('/bg.png')}");
  });

  it('rewrites an unquoted url()', () => {
    const out = rewriteCss('a{background:url(https://example.com/bg.png)}', baseOptions());
    expect(out).toBe('a{background:url("/bg.png")}');
  });

  it('resolves a relative url() against the stylesheet URL', () => {
    const out = rewriteCss('a{background:url("../img/bg.png")}', baseOptions());
    expect(out).toBe('a{background:url("/img/bg.png")}');
  });

  it('leaves a disallowed-host url() untouched', () => {
    const css = 'a{background:url("https://evil.com/bg.png")}';
    expect(rewriteCss(css, baseOptions())).toBe(css);
  });

  it('leaves a data: URI untouched', () => {
    const css = 'a{background:url("data:image/png;base64,abcd")}';
    expect(rewriteCss(css, baseOptions())).toBe(css);
  });

  it('rewrites an allowed subdomain with the host-override query param', () => {
    const out = rewriteCss('a{background:url("https://cdn.example.com/bg.png")}', baseOptions());
    expect(out).toBe('a{background:url("/bg.png?__mobilio_host=cdn.example.com")}');
  });

  it('rewrites multiple url() references in one stylesheet', () => {
    const css =
      '@font-face{src:url("https://example.com/f.woff2")}' + 'a{background:url("https://example.com/bg.png")}';
    const out = rewriteCss(css, baseOptions());
    expect(out).toBe('@font-face{src:url("/f.woff2")}' + 'a{background:url("/bg.png")}');
  });

  it('leaves an empty url() untouched', () => {
    const css = 'a{background:url()}';
    expect(rewriteCss(css, baseOptions())).toBe(css);
  });
});
