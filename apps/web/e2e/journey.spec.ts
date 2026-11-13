import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import enMessages from '../messages/en.json';
import ruMessages from '../messages/ru.json';
import { extractUrl, readMailLines, resetRateLimitBuckets, waitForMail } from './helpers';

const API_BASE = 'http://localhost:3011';
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

type Locale = 'en' | 'ru';
const MESSAGES: Record<Locale, typeof enMessages> = { en: enMessages, ru: ruMessages };

/** "as-needed": en (default) has no url prefix, ru does. */
function localePath(locale: Locale, path: string): string {
  return locale === 'ru' ? `/ru${path}` : path;
}

/** A minimal real local "site" with one nav link, so analyzeSite produces exactly one real tab to edit. */
function startSite(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>Journey Test Site</title></head>' +
          '<body><nav><a href="/">Home</a></nav></body></html>',
      );
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

type FakeRunnerDispatch = { id: string; token: string; baseUrl: string };

async function fakeRunnerDispatched(page: Page): Promise<FakeRunnerDispatch[]> {
  const res = await page.request.get(`${API_BASE}/_test/fake-runner/dispatched`);
  return res.json();
}

/** Plays the GitHub Actions runner's part against the real api, same callback sequence build-ipa.yml makes for real. */
async function driveFakeBuildToDone(page: Page, build: FakeRunnerDispatch): Promise<void> {
  const bearer = { Authorization: `Bearer ${build.token}` };

  await page.request.post(`${API_BASE}/builds/${build.id}/start`, {
    headers: bearer,
    data: { runId: 999, runUrl: 'https://github.com/example/example/actions/runs/999' },
  });

  const zip = Buffer.concat([ZIP_HEADER, Buffer.from('fake e2e journey ipa contents')]);
  await page.request.post(`${API_BASE}/builds/${build.id}/ipa`, {
    headers: { ...bearer, 'Content-Type': 'application/octet-stream' },
    data: zip,
  });
}

async function runFullJourney(page: Page, locale: Locale): Promise<void> {
  const t = MESSAGES[locale];
  const email = `e2e-journey-${locale}-${Date.now()}@example.com`;
  const newTabTitle = locale === 'ru' ? 'Магазин' : 'Shop';
  const newColor = '#112233';

  const site = await startSite();
  try {
    // --- home -> enter the test site's url -> draft editor ---
    await page.goto(localePath(locale, '/'));
    await page.getByPlaceholder(t.home.urlPlaceholder).fill(`http://127.0.0.1:${site.port}/`);
    await page.getByRole('button', { name: t.home.submit }).click();
    await page.waitForURL('**/try');

    // --- change theme color + a tab's title ---
    const colorInput = page.locator('input[type="color"]').first();
    await colorInput.fill(newColor);
    await page.getByLabel(t.editor.tabTitleLabel).first().fill(newTabTitle);
    await page.getByRole('button', { name: t.editor.save }).click();
    await expect(page.getByText(t.editor.saved)).toBeVisible();

    // --- preview reflects the saved change (the tab bar re-renders from savedConfig) ---
    await expect(page.getByRole('button', { name: newTabTitle })).toBeVisible();

    // --- QR code ---
    await page.getByRole('button', { name: t.preview.openOnIphone }).click();
    await expect(page.getByAltText(t.preview.qrAlt)).toBeVisible();

    // --- save as project: sign in via magic link ---
    const sinceSignIn = readMailLines().length;
    await resetRateLimitBuckets();
    await page.getByRole('link', { name: t.claim.saveAsProject }).click();
    await page.waitForURL('**/login**');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByRole('button', { name: t.login.sendLink }).click();
    await expect(page.getByText(t.login.sent)).toBeVisible();

    const signInMail = await waitForMail(email, '/api/auth/magic-link/verify', sinceSignIn);
    await resetRateLimitBuckets();
    await page.goto(extractUrl(signInMail.body));
    await page.waitForURL('**/try');

    // --- claim the draft into the (auto-created personal) org ---
    await page.getByRole('button', { name: t.claim.saveAsProject }).click();
    await page.waitForURL(/\/projects\//);
    const projectUrl = page.url();

    // --- project editor shows the same changes made as a draft ---
    await expect(page.locator('input[type="color"]').first()).toHaveValue(newColor);
    await expect(page.getByLabel(t.editor.tabTitleLabel).first()).toHaveValue(newTabTitle);
    await expect(page.getByRole('button', { name: newTabTitle })).toBeVisible();

    // --- a page refresh re-fetches from the real api and keeps the same values ---
    await page.reload();
    await expect(page.locator('input[type="color"]').first()).toHaveValue(newColor);
    await expect(page.getByLabel(t.editor.tabTitleLabel).first()).toHaveValue(newTabTitle);

    // --- build flow (NEXT_PUBLIC_ENABLE_BUILDS=true, FakeRunner) ---
    const beforeDispatch = (await fakeRunnerDispatched(page)).length;
    await page.getByRole('button', { name: t.builds.start }).click();
    await expect(page.getByText(t.builds.statusQueued)).toBeVisible();

    const dispatched = await fakeRunnerDispatched(page);
    const myBuild = dispatched[beforeDispatch];
    if (!myBuild) throw new Error('FakeRunner never recorded a dispatch for this build');
    await driveFakeBuildToDone(page, myBuild);

    const downloadLink = page.getByRole('link', { name: t.builds.downloadIpa });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });
    await expect(downloadLink).toHaveAttribute('href', new RegExp(`/builds/${myBuild.id}/ipa$`));

    // --- sign out / sign in again: the project is still there ---
    await page.getByRole('button', { name: t.header.signOut }).click();
    await page.getByRole('link', { name: t.header.signIn }).waitFor();

    const sinceSecondSignIn = readMailLines().length;
    await resetRateLimitBuckets();
    await page.goto(localePath(locale, '/login'));
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByRole('button', { name: t.login.sendLink }).click();
    await expect(page.getByText(t.login.sent)).toBeVisible();

    const secondSignInMail = await waitForMail(email, '/api/auth/magic-link/verify', sinceSecondSignIn);
    await resetRateLimitBuckets();
    await page.goto(extractUrl(secondSignInMail.body));

    await page.goto(projectUrl);
    await expect(page.locator('input[type="color"]').first()).toHaveValue(newColor);
    await expect(page.getByLabel(t.editor.tabTitleLabel).first()).toHaveValue(newTabTitle);
  } finally {
    await new Promise((resolve) => site.server.close(resolve));
  }
}

test.describe('full user journey: home -> draft -> claim -> project -> build -> persists across sign-out/in', () => {
  test('en locale (default, no url prefix)', async ({ page }) => {
    test.setTimeout(150_000);
    await runFullJourney(page, 'en');
  });

  test('ru locale (/ru prefix, Russian headers)', async ({ page }) => {
    test.setTimeout(150_000);
    await runFullJourney(page, 'ru');
  });
});
