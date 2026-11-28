import { expect, test } from '@playwright/test';
import { E2E_API_ORIGIN } from './helpers';

const routes = ['/', '/pricing', '/login', '/legal/terms', '/legal/privacy', '/legal/refunds', '/missing-page'];
const widths = [320, 390, 1440];

test('Part A public routes never overflow horizontally', async ({ page }) => {
  await page.route(`${E2E_API_ORIGIN}/me`, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route(`${E2E_API_ORIGIN}/drafts/me`, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.locator('body').innerText()).not.toMatch(/\[[A-Z][A-Z _-]*\]/);
    }
  }
});
