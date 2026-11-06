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

  it('injects a document.cookie setter override with a correctly-escaped Domain-stripping regex', async () => {
    const out = await rewriteHtml('<html><body></body></html>', baseOptions());
    // Guards against a real bug caught during development: an UNTAGGED template literal
    // silently eats a bare `\s` (it's not a recognized string escape), collapsing the
    // regex source to garbage (`s*domains*=`) that matches nothing — the literal output
    // must contain an actual backslash-s, not just the letter s.
    expect(out).toContain("Object.defineProperty(Document.prototype,'cookie'");
    expect(out).toContain('\\s*domain\\s*=');
  });

  it("the injected cookie setter override actually strips a Domain attribute when executed", async () => {
    const out = await rewriteHtml('<html><body></body></html>', baseOptions());
    const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(out);
    expect(scriptMatch).not.toBeNull();
    // Executes the real extracted script against a minimal Document-prototype stand-in
    // (not a full jsdom/browser) — cheap, and exercises the exact same
    // Object.defineProperty/replace logic a real browser would run.
    const fakeDocumentProto: { cookie?: string } = {};
    let backingStore = '';
    Object.defineProperty(fakeDocumentProto, 'cookie', {
      configurable: true,
      get() {
        return backingStore;
      },
      set(v: string) {
        backingStore = String(v);
      },
    });
    const sandbox = {
      Document: { prototype: fakeDocumentProto },
      document: { addEventListener: () => {} },
      window: {},
      Object,
      String,
    };
    const run = new Function(...Object.keys(sandbox), scriptMatch![1]!);
    run(...Object.values(sandbox));
    (fakeDocumentProto as unknown as { cookie: string }).cookie = 'name=value; Domain=proxy.example; Path=/';
    expect(backingStore).toBe('name=value; Path=/');
  });

  it('injects the Preview banner right after <body>, and the cookie/click-interceptor script before <head>', async () => {
    const out = await rewriteHtml('<html><head><title>T</title></head><body><p>hi</p></body></html>', baseOptions());
    const headIdx = out.indexOf('<head>');
    const scriptIdx = out.indexOf('<script>');
    const titleIdx = out.indexOf('<title>');
    const bodyIdx = out.indexOf('<body>');
    const bannerIdx = out.indexOf('Preview · Mobilio');
    const pIdx = out.indexOf('<p>hi</p>');
    expect(scriptIdx).toBeGreaterThan(headIdx);
    expect(scriptIdx).toBeLessThan(titleIdx);
    expect(bannerIdx).toBeGreaterThan(bodyIdx);
    expect(bannerIdx).toBeLessThan(pIdx);
    expect(out).toContain('window.open');
  });

  it('falls back to injecting the script right before <body> when the document has no <head> at all', async () => {
    const out = await rewriteHtml('<html><body><p>hi</p></body></html>', baseOptions());
    const scriptIdx = out.indexOf('<script>');
    const bodyIdx = out.indexOf('<body>');
    const pIdx = out.indexOf('<p>hi</p>');
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(pIdx);
  });

  it('does not inject the script for a bodyless fragment (no <head>, no <body>) — an accepted gap, no real site serves this', async () => {
    const out = await rewriteHtml('<p>hi</p>', baseOptions());
    expect(out).not.toContain('<script>');
  });

  it('wraps window.cookieStore.set to strip a domain option from the object-form overload', async () => {
    const out = await rewriteHtml('<html><body></body></html>', baseOptions());
    const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(out);
    expect(scriptMatch).not.toBeNull();
    const calls: Array<Record<string, unknown> | [string, string]> = [];
    const sandbox = {
      Document: { prototype: {} },
      document: { addEventListener: () => {} },
      window: {
        cookieStore: {
          set: (...args: unknown[]) => {
            calls.push(args.length === 1 ? (args[0] as Record<string, unknown>) : (args as [string, string]));
          },
        },
      },
      Object,
      String,
    };
    const run = new Function(...Object.keys(sandbox), scriptMatch![1]!);
    run(...Object.values(sandbox));
    await (sandbox.window.cookieStore.set as unknown as (opts: Record<string, unknown>) => void)({
      name: 'n',
      value: 'v',
      domain: 'proxy.example',
    });
    expect(calls).toEqual([{ name: 'n', value: 'v' }]);
  });

  it('leaves the two-argument cookieStore.set(name, value) overload untouched (no domain option to strip)', async () => {
    const out = await rewriteHtml('<html><body></body></html>', baseOptions());
    const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(out);
    const calls: unknown[] = [];
    const sandbox = {
      Document: { prototype: {} },
      document: { addEventListener: () => {} },
      window: { cookieStore: { set: (...args: unknown[]) => calls.push(args) } },
      Object,
      String,
    };
    const run = new Function(...Object.keys(sandbox), scriptMatch![1]!);
    run(...Object.values(sandbox));
    (sandbox.window.cookieStore.set as unknown as (n: string, v: string) => void)('n', 'v');
    expect(calls).toEqual([['n', 'v']]);
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
