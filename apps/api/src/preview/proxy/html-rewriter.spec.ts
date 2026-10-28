import { Readable } from 'node:stream';
import { createHtmlRewriteStream, type HtmlRewriterOptions } from './html-rewriter.js';

function baseOptions(overrides: Partial<HtmlRewriterOptions> = {}): HtmlRewriterOptions {
  return {
    allowlist: { baseHost: 'example.com' },
    currentPageUrl: new URL('https://example.com/page'),
    primaryHost: 'example.com',
    ...overrides,
  };
}

async function rewriteHtml(html: string, options: HtmlRewriterOptions): Promise<string> {
  const source = Readable.from([html]);
  source.setEncoding('utf8');
  const rewriter = createHtmlRewriteStream(options);
  source.pipe(rewriter);
  const chunks: string[] = [];
  for await (const chunk of rewriter) {
    chunks.push(chunk as string);
  }
  return chunks.join('');
}

describe('createHtmlRewriteStream', () => {
  it('rewrites an allowed-host absolute link into a bare path-absolute reference', async () => {
    const out = await rewriteHtml('<a href="https://example.com/about">About</a>', baseOptions());
    expect(out).toContain('href="/about"');
  });

  it('rewrites an allowed subdomain with the host-override query param', async () => {
    const out = await rewriteHtml('<img src="https://cdn.example.com/logo.png">', baseOptions());
    expect(out).toContain('src="/logo.png?__mobilio_host=cdn.example.com"');
  });

  it('leaves a disallowed-host link untouched', async () => {
    const out = await rewriteHtml('<a href="https://evil.com/x">x</a>', baseOptions());
    expect(out).toContain('href="https://evil.com/x"');
  });

  it('leaves non-http(s) schemes untouched', async () => {
    const out = await rewriteHtml('<a href="mailto:test@example.com">mail</a>', baseOptions());
    expect(out).toContain('href="mailto:test@example.com"');
  });

  it('leaves an already path-absolute, same-origin href as-is (resolving+rewriting it is a no-op by construction)', async () => {
    const out = await rewriteHtml('<a href="/pricing">Pricing</a>', baseOptions());
    expect(out).toContain('href="/pricing"');
  });

  it('resolves a genuinely relative href against the current page URL', async () => {
    const out = await rewriteHtml('<a href="../other.html">Other</a>', {
      ...baseOptions(),
      currentPageUrl: new URL('https://example.com/dir/page.html'),
    });
    expect(out).toContain('href="/other.html"');
  });

  it('does not insert a <base> tag at all', async () => {
    const out = await rewriteHtml('<html><head><title>T</title></head><body></body></html>', baseOptions());
    expect(out).not.toContain('<base');
  });

  it('strips a <meta http-equiv="Content-Security-Policy"> tag', async () => {
    const out = await rewriteHtml(
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><title>T</title></head><body></body></html>',
      baseOptions(),
    );
    expect(out).not.toContain('Content-Security-Policy');
    expect(out).toContain('<title>T</title>');
  });

  it('strips a <meta http-equiv="X-Frame-Options"> tag', async () => {
    const out = await rewriteHtml('<html><head><meta http-equiv="X-Frame-Options" content="DENY"></head><body></body></html>', baseOptions());
    expect(out).not.toContain('X-Frame-Options');
  });

  it('is case-insensitive when matching the http-equiv value', async () => {
    const out = await rewriteHtml('<meta http-equiv="content-security-policy" content="default-src \'none\'">', baseOptions());
    expect(out).not.toContain('content-security-policy');
  });

  it('leaves an unrelated <meta http-equiv> tag untouched', async () => {
    const out = await rewriteHtml('<meta http-equiv="refresh" content="30">', baseOptions());
    expect(out).toContain('http-equiv="refresh"');
  });

  it('leaves a <meta> tag with no http-equiv attribute untouched', async () => {
    const out = await rewriteHtml('<meta charset="utf-8">', baseOptions());
    expect(out).toContain('charset="utf-8"');
  });

  it('still injects the banner/click-interceptor on a page with a restrictive meta-CSP (which would otherwise block it)', async () => {
    const out = await rewriteHtml(
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head><body><p>hi</p></body></html>',
      baseOptions(),
    );
    expect(out).not.toContain('Content-Security-Policy');
    expect(out).toContain('Preview · Mobilio');
    expect(out).toContain('window.open');
  });

  it('injects the Preview banner and click-interceptor script right after <body>', async () => {
    const out = await rewriteHtml('<html><body><p>hi</p></body></html>', baseOptions());
    const bodyIdx = out.indexOf('<body>');
    const bannerIdx = out.indexOf('Preview · Mobilio');
    const pIdx = out.indexOf('<p>hi</p>');
    expect(bannerIdx).toBeGreaterThan(bodyIdx);
    expect(bannerIdx).toBeLessThan(pIdx);
    expect(out).toContain('window.open');
  });

  it('does not rewrite inline <script> contents (JS is never rewritten)', async () => {
    const js = 'fetch("https://example.com/api/data").then(x=>x);';
    const out = await rewriteHtml(`<script>${js}</script>`, baseOptions());
    expect(out).toContain(js);
  });

  it('does not touch attributes outside the known url-attribute set', async () => {
    const out = await rewriteHtml('<div data-href="https://example.com/x">d</div>', baseOptions());
    expect(out).toContain('data-href="https://example.com/x"');
  });

  it('preserves attributes and text content of untouched tags (re-serialized, not byte-identical)', async () => {
    // parse5-html-rewriting-stream re-serializes any tag whose event has a listener
    // (startTag/endTag here), normalizing quote style and attribute spacing even when
    // the tag itself isn't modified — only events with NO listener (text, comments,
    // doctype) pass through using their raw source. So this asserts the content survives,
    // not literal byte-for-byte formatting.
    const html = '<p class="x y"   id=\'z\'>Hello &amp; world</p>';
    const out = await rewriteHtml(html, baseOptions());
    expect(out).toContain('<p class="x y" id="z">');
    expect(out).toContain('Hello &amp; world</p>');
  });

  it('rewrites form action, video src/poster, and audio src', async () => {
    const html =
      '<form action="https://example.com/submit"></form>' +
      '<video src="https://example.com/v.mp4" poster="https://example.com/p.jpg"></video>' +
      '<audio src="https://example.com/a.mp3"></audio>';
    const out = await rewriteHtml(html, baseOptions());
    expect(out).toContain('action="/submit"');
    expect(out).toContain('src="/v.mp4"');
    expect(out).toContain('poster="/p.jpg"');
    expect(out).toContain('src="/a.mp3"');
  });

  it('handles a multi-byte UTF-8 character split across chunk boundaries', async () => {
    const html = '<p>café 😀</p>';
    const bytes = Buffer.from(html, 'utf8');
    const mid = Math.floor(bytes.length / 2);
    const source = Readable.from([bytes.subarray(0, mid), bytes.subarray(mid)]);
    source.setEncoding('utf8');
    const rewriter = createHtmlRewriteStream(baseOptions());
    source.pipe(rewriter);
    const chunks: string[] = [];
    for await (const chunk of rewriter) {
      chunks.push(chunk as string);
    }
    expect(chunks.join('')).toContain('café 😀');
  });
});
