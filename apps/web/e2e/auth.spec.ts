import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { MAIL_LOG_FILE } from './mailLog';

interface LoggedMail {
  to: string;
  subject: string;
  body: string;
}

function readMailLines(): string[] {
  if (!existsSync(MAIL_LOG_FILE)) return [];
  return readFileSync(MAIL_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
}

/**
 * Only matches lines appended after `sinceLine` — without this, re-signing in with the
 * same email (e.g. the register-then-login-again test) can match the *first* sign-in's
 * already-consumed magic-link token instead of the second one, since both share the
 * same `to` address and the file is append-only across the whole test run.
 */
async function waitForMail(to: string, bodyIncludes: string, sinceLine: number, timeoutMs = 10_000): Promise<LoggedMail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = readMailLines();
    const match = lines
      .slice(sinceLine)
      .map((line) => JSON.parse(line) as LoggedMail)
      .find((m) => m.to === to && m.body.includes(bodyIncludes));
    if (match) return match;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for mail to ${to} containing "${bodyIncludes}"`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function extractUrl(body: string): string {
  const [url] = body.match(/https?:\/\/\S+/) ?? [];
  if (!url) throw new Error(`No URL found in mail body: ${body}`);
  return url;
}

function redisClient(): Redis {
  const redisUrl = process.env.E2E_API_REDIS_URL ?? 'redis://localhost:6380';
  return new Redis(redisUrl);
}

// Flushed before every individual sign-in, not just once per test: Better Auth's
// rate-limit buckets are shared across the whole Redis instance, and this suite's own
// multi-sign-in test flows accumulate toward them fast enough to trip a limit within a
// single test otherwise. Safe here specifically because no verification token exists
// yet at this point — flushing *after* requesting the magic link would wipe the token
// itself, since Better Auth stores it in the same Redis (secondaryStorage).
async function resetRateLimitsBeforeRequest(): Promise<void> {
  const redis = redisClient();
  await redis.flushdb();
  await redis.quit();
}

// Verify has its own, separately-keyed rate-limit bucket from sign-in — cleared via a
// targeted delete (not flushdb) so the magic-link token requested moments ago, which
// lives in the same Redis, survives.
async function resetVerifyRateLimit(): Promise<void> {
  const redis = redisClient();
  await redis.del('no-trusted-ip|/magic-link/verify');
  await redis.quit();
}

async function signInByMagicLink(page: Page, email: string): Promise<void> {
  await resetRateLimitsBeforeRequest();
  const sinceLine = readMailLines().length;

  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Отправить ссылку для входа' }).click();
  await page.getByText('Проверьте почту').waitFor();

  const mail = await waitForMail(email, '/api/auth/magic-link/verify', sinceLine);
  await resetVerifyRateLimit();
  await page.goto(extractUrl(mail.body));
  await page.waitForURL('http://localhost:3100/**');
}

test.describe('auth', () => {
  test('register via magic link -> personal org created -> logout -> login again', async ({ page }) => {
    const email = `e2e-auth-${Date.now()}@example.com`;

    await signInByMagicLink(page, email);
    await page.goto('/');

    await expect(page.getByText(email)).toBeVisible();
    const orgOption = page.locator('header select option');
    await expect(orgOption).toHaveCount(1);
    const firstOrgName = await orgOption.first().textContent();
    expect(firstOrgName).toContain('workspace');

    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.getByRole('link', { name: 'Войти' }).waitFor();

    // Login again as the same (now existing, not new) user — same personal org, not a
    // second one created.
    await signInByMagicLink(page, email);
    await page.goto('/');
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.locator('header select option')).toHaveCount(1);
    await expect(page.locator('header select option').first()).toHaveText(firstOrgName!);
  });

  test('inviting a second user by email lets them see the organization after accepting', async ({ page }) => {
    const ownerEmail = `e2e-owner-${Date.now()}@example.com`;
    const inviteeEmail = `e2e-invitee-${Date.now()}@example.com`;

    await signInByMagicLink(page, ownerEmail);

    const me = await page.request.get('http://localhost:3011/me');
    const meBody = await me.json();
    const orgId = meBody.organizations[0].id as string;

    const sinceLine = readMailLines().length;

    // No invite UI exists yet (out of Section 5's scope) — API calls reuse the same
    // browser-context session cookie the page itself just established.
    const inviteRes = await page.request.post(`http://localhost:3011/orgs/${orgId}/invitations`, {
      data: { email: inviteeEmail, role: 'member' },
    });
    expect(inviteRes.ok()).toBe(true);

    const inviteMail = await waitForMail(inviteeEmail, '/invitations/accept', sinceLine);
    const token = new URL(extractUrl(inviteMail.body)).searchParams.get('token');
    expect(token).toBeTruthy();

    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.getByRole('link', { name: 'Войти' }).waitFor();

    await signInByMagicLink(page, inviteeEmail);

    const acceptRes = await page.request.post('http://localhost:3011/invitations/accept', {
      data: { token },
    });
    expect(acceptRes.ok()).toBe(true);

    await page.goto('/');
    // Header's fetchMe() is async — without waiting for a stable signal first,
    // allTextContents() below can read the DOM while the header is still in its
    // "loading" (renders nothing) state, returning an empty array regardless of what
    // the server actually has.
    await expect(page.getByText(inviteeEmail)).toBeVisible();
    const orgOptions = page.locator('header select option');
    await expect(orgOptions).toHaveCount(2);
    const orgNames = await orgOptions.allTextContents();
    expect(orgNames.length).toBe(2);
  });
});
