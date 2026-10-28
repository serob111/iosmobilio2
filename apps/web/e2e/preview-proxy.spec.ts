import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

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

/** Drives /try end to end for a given site, returning the live preview iframe's src (its own origin + path). */
async function createPreviewFor(page: import('@playwright/test').Page, site: Site): Promise<string> {
  await page.goto('/try');
  await page.getByPlaceholder('Адрес вашего сайта, например example.com').fill(`http://127.0.0.1:${site.port}/`);
  await page.getByRole('button', { name: 'Показать превью' }).click();
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
    // with no <base> override or rewriting needed.
    const bgResponse = await directB.request.get(`${originB}/bg.png`);
    expect(bgResponse.status()).toBe(200);

    await directA.close();
    await directB.close();
  });
});
