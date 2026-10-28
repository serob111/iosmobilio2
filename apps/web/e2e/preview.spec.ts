import { test, expect } from '@playwright/test';

const API_ORIGIN = 'http://localhost:3011';
const PROXY_ORIGIN = 'http://preview.e2e.test';
const SLUG = 'e2e-test-slug';

const PREVIEW_DTO = {
  name: 'E2E Test Cafe',
  theme: { primary: '#4B2BE0', background: '#ffffff', statusBar: 'dark' },
  statusBar: 'dark',
  tabs: [
    { title: 'Главная', icon: 'home', path: '/' },
    { title: 'Каталог', icon: 'cart', path: '/catalog' },
  ],
  iconUrl: `${PROXY_ORIGIN}/icon.png`,
  proxyBase: PROXY_ORIGIN,
};

/**
 * Exercises the whole draft -> preview UI flow in a real browser. Mocks apps/api and the
 * proxied "site" at the network boundary via page.route() — the same philosophy as
 * e2e/server.ts's in-process MSW for the legacy flow, just at the browser's own network
 * layer instead of the Next.js server's — rather than depending on a real external site
 * being reachable through apps/api's own SSRF-safe fetch (which deliberately refuses
 * loopback/private addresses, and this sandbox has no outbound internet access to a real
 * one either). The real apps/api process this suite's webServer starts is never actually
 * called by this test; it only needs to exist (and boot successfully) for the *other*
 * e2e specs that do need a real session/RLS round trip.
 */
test('enter a URL, see the draft preview in a frame, switch tabs, and see the QR code', async ({ page }) => {
  await page.route(`${API_ORIGIN}/drafts`, async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route(`${API_ORIGIN}/drafts/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-1',
        name: PREVIEW_DTO.name,
        sourceUrl: 'https://e2e-test-site.example/',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
  });
  await page.route(`${API_ORIGIN}/drafts/me/preview-link`, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ url: `http://localhost:3100/preview/${SLUG}` }),
    });
  });
  await page.route(`${API_ORIGIN}/preview/${SLUG}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PREVIEW_DTO) });
  });
  await page.route(`${API_ORIGIN}/me`, async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.route(`${PROXY_ORIGIN}/icon.png`, async (route) => {
    // A minimal 1x1 transparent PNG, inlined — the icon just needs to load, not look like anything.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await route.fulfill({ status: 200, contentType: 'image/png', body: onePixelPng });
  });
  await page.route(`${PROXY_ORIGIN}/`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><h1>Home page</h1></body></html>' });
  });
  await page.route(`${PROXY_ORIGIN}/catalog`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Catalog page</h1></body></html>',
    });
  });

  await page.goto('/try');
  await page.getByPlaceholder('Адрес вашего сайта, например example.com').fill('e2e-test-site.example');
  await page.getByRole('button', { name: 'Показать превью' }).click();

  const homeFrame = page.frameLocator('iframe[title="Главная"]');
  await expect(homeFrame.getByRole('heading', { name: 'Home page' })).toBeVisible();

  await page.getByRole('button', { name: 'Каталог' }).click();
  const catalogFrame = page.frameLocator('iframe[title="Каталог"]');
  await expect(catalogFrame.getByRole('heading', { name: 'Catalog page' })).toBeVisible();

  await page.getByRole('button', { name: 'Открыть на iPhone' }).click();
  await expect(page.getByAltText('QR-код превью')).toBeVisible();
  await expect(page.getByRole('link', { name: `http://localhost:3100/preview/${SLUG}` })).toBeVisible();
});
