import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetRateLimitBuckets } from './helpers';

type Site = { server: Server; port: number; name: string };

/**
 * A REAL local "site" (not mocked) — this test needs the REAL preview proxy, not
 * page.route() mocking, since the whole point is proving a browser-enforced property
 * (cookies/localStorage never crossing between two different previews' origins) that a
 * mock would make a tautology. Each site sets a distinctive cookie + localStorage value
 * on load, serves its own relative `fetch('/api/x')` endpoint, and references an
 * absolute-path image from an inline <style> block — exercising exactly the three
 * "works for free once every preview has its own real origin" cases pункт 5's follow-up
 * review asked for.
 */
function startSite(name: string): Promise<Site> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://site.invalid');
      if (url.pathname === '/api/x') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ site: name }));
        return;
      }
      if (url.pathname === '/bg.png') {
        // A minimal 1x1 transparent PNG.
        const onePixelPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        );
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(onePixelPng);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><style>#bg{background:url(/bg.png) no-repeat;width:1px;height:1px;}</style></head>` +
          `<body><p id="status">loading</p><div id="bg"></div>` +
          `<script>` +
          `document.cookie = 'sitecookie=${name}; path=/';` +
          `localStorage.setItem('sitelocal', '${name}');` +
          `fetch('/api/x').then(r=>r.json()).then(d => { document.getElementById('status').textContent = 'api:' + d.site; });` +
          `</script></body></html>`,
      );
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, name }));
  });
}

/**
 * A site that tries to widen its own cookie's scope to the whole PREVIEW_PROXY_DOMAIN
 * (not just its own slug subdomain) via an explicit `Domain=` attribute — exactly the
 * attack the injected cookie-setter override (html-rewriter.ts) exists to defuse. Without
 * that override, per RFC 6265's domain-matching rules a browser accepts `Domain=` set to
 * the current host's own domain or any parent of it (PREVIEW_PROXY_DOMAIN here IS a
 * parent of `<slug>.PREVIEW_PROXY_DOMAIN`), making the cookie visible to every OTHER
 * preview sharing that same PREVIEW_PROXY_DOMAIN.
 */
function startWideCookieSite(name: string, proxyDomain: string): Promise<Site> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><body><p id="status">ready</p>` +
          `<script>document.cookie = 'widecookie=${name}; Domain=${proxyDomain}; Path=/';</script>` +
          `</body></html>`,
      );
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, name }));
  });
}

/** Drives "/" -> /try end to end for a given site, returning the live preview iframe's src (its own origin + path). */
async function createPreviewFor(page: import('@playwright/test').Page, site: Site): Promise<string> {
  await page.goto('/');
  await page.getByPlaceholder("Your site's address, e.g. example.com").fill(`http://127.0.0.1:${site.port}/`);
  await page.getByRole('button', { name: 'Show preview' }).click();
  await page.waitForURL('**/try');
  const iframe = page.locator('iframe').first();
  await expect(iframe).toBeVisible({ timeout: 15_000 });
  const src = await iframe.getAttribute('src');
  if (!src) throw new Error('Preview iframe has no src');
  return src;
}

test.describe('preview proxy: real cross-origin isolation (real api, real local sites, no mocking)', () => {
  let siteA: Site;
  let siteB: Site;

  test.beforeAll(async () => {
    siteA = await startSite('site-a');
    siteB = await startSite('site-b');
  });

  // Each test in this file creates 2 real drafts (one per site) — well under the 10/10min
  // limit on its own, but shared with every other spec file hitting the same real api
  // process across a run (or repeated local runs), draft-rate-limit:<ip> adds up fast.
  test.beforeEach(async () => {
    await resetRateLimitBuckets();
  });

  test.afterAll(async () => {
    await new Promise((resolve) => siteA.server.close(resolve));
    await new Promise((resolve) => siteB.server.close(resolve));
  });

  test('two different sites get two different preview origins; cookies/localStorage set in one are not visible in the other', async ({
    page,
    context,
  }) => {
    const srcA = await createPreviewFor(page, siteA);
    const originA = new URL(srcA).origin;

    // Reset to a clean draft flow for the second site — /try itself has no "reset"
    // affordance, a fresh navigation starts a brand new draft/preview-link.
    const srcB = await createPreviewFor(page, siteB);
    const originB = new URL(srcB).origin;

    expect(originA).not.toBe(originB);

    // Navigate straight to each origin (bypassing the shell) to read cookies/localStorage
    // at the browser level, scoped per-origin exactly as a real visitor's browser would.
    const directA = await context.newPage();
    await directA.goto(originA);
    await expect(directA.locator('#status')).toHaveText('api:site-a', { timeout: 10_000 });
    const cookiesA = await context.cookies(originA);
    const localA = await directA.evaluate(() => window.localStorage.getItem('sitelocal'));
    expect(cookiesA.some((c) => c.name === 'sitecookie' && c.value === 'site-a')).toBe(true);
    expect(localA).toBe('site-a');

    const directB = await context.newPage();
    await directB.goto(originB);
    await expect(directB.locator('#status')).toHaveText('api:site-b', { timeout: 10_000 });
    const cookiesB = await context.cookies(originB);
    const localB = await directB.evaluate(() => window.localStorage.getItem('sitelocal'));
    // site-b's own origin must see only its own cookie/localStorage, never site-a's —
    // this is what actually proves the two previews got genuinely different origins,
    // not just different paths under a shared one.
    expect(cookiesB.some((c) => c.name === 'sitecookie' && c.value === 'site-a')).toBe(false);
    expect(cookiesB.some((c) => c.name === 'sitecookie' && c.value === 'site-b')).toBe(true);
    expect(localB).toBe('site-b');

    // The absolute-path background image (from an inline <style>, never touched by the
    // HTML rewriter) loads successfully through the proxy — proving a same-origin
    // absolute-path reference just works once every preview has its own real origin,
    // with no <base> override or rewriting needed. Fetched via an in-page
    // `fetch()` (not `request.get`, Playwright's separate Node-side API-request client)
    // — that client does its own DNS resolution outside the browser's network stack,
    // which doesn't know about Chromium's own `*.localhost` special-casing and would
    // fail with ENOTFOUND for an arbitrary slug subdomain.
    const bgStatus = await directB.evaluate(async (url) => {
      const res = await fetch(url);
      return res.status;
    }, `${originB}/bg.png`);
    expect(bgStatus).toBe(200);

    await directA.close();
    await directB.close();
  });

  test('a cookie set with Domain=<PREVIEW_PROXY_DOMAIN> by one preview is not visible to another preview', async ({
    page,
    context,
  }) => {
    const wideA = await startWideCookieSite('wide-a', 'preview.localhost');
    const wideB = await startWideCookieSite('wide-b', 'preview.localhost');
    try {
      const srcA = await createPreviewFor(page, wideA);
      const originA = new URL(srcA).origin;
      const srcB = await createPreviewFor(page, wideB);
      const originB = new URL(srcB).origin;
      expect(originA).not.toBe(originB);

      const directA = await context.newPage();
      await directA.goto(originA);
      await expect(directA.locator('#status')).toHaveText('ready');

      const directB = await context.newPage();
      await directB.goto(originB);
      await expect(directB.locator('#status')).toHaveText('ready');

      // The cookie really was set (both sites legitimately have their own "widecookie" —
      // same name, different value) — just scoped to its own origin only, because the
      // Domain attribute was stripped before the browser ever saw it. Checking the
      // *host* each cookie actually ended up scoped to (not merely "a cookie named
      // widecookie exists", which would trivially be true for both sites' own, correctly
      // host-scoped cookie) is what actually proves the attribute was stripped, and
      // checking neither site's *value* is visible from the other's origin is what
      // proves it never leaked.
      const hostA = new URL(originA).hostname;
      const hostB = new URL(originB).hostname;

      const cookiesA = await context.cookies(originA);
      const wideCookieOnA = cookiesA.find((c) => c.name === 'widecookie');
      expect(wideCookieOnA?.value).toBe('wide-a');
      expect(wideCookieOnA?.domain).toBe(hostA);

      const cookiesB = await context.cookies(originB);
      const wideCookieOnB = cookiesB.find((c) => c.name === 'widecookie');
      expect(wideCookieOnB?.value).toBe('wide-b');
      expect(wideCookieOnB?.domain).toBe(hostB);

      expect(cookiesA.some((c) => c.name === 'widecookie' && c.value === 'wide-b')).toBe(false);
      expect(cookiesB.some((c) => c.name === 'widecookie' && c.value === 'wide-a')).toBe(false);

      await directA.close();
      await directB.close();
    } finally {
      await new Promise((resolve) => wideA.server.close(resolve));
      await new Promise((resolve) => wideB.server.close(resolve));
    }
  });
});
