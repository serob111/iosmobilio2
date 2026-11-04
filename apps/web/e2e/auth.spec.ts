import { expect, test, type Page } from '@playwright/test';
import { extractUrl, readMailLines, resetRateLimitBuckets, waitForMail } from './helpers';

async function signInByMagicLink(page: Page, email: string): Promise<void> {
  await resetRateLimitBuckets();
  const sinceLine = readMailLines().length;

  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await page.getByText('Check your email').waitFor();

  const mail = await waitForMail(email, '/api/auth/magic-link/verify', sinceLine);
  await resetRateLimitBuckets();
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

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Sign in' }).waitFor();

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
    // browser-context session cookie the page itself just established. Unlike a real
    // in-page fetch(), Playwright's request fixture doesn't attach an Origin header on
    // its own, so it's set explicitly here to pass apps/api's CSRF Origin check the way
    // a real browser-driven request naturally would.
    const inviteRes = await page.request.post(`http://localhost:3011/orgs/${orgId}/invitations`, {
      headers: { Origin: 'http://localhost:3100' },
      data: { email: inviteeEmail, role: 'member' },
    });
    expect(inviteRes.ok()).toBe(true);

    const inviteMail = await waitForMail(inviteeEmail, '/invitations/accept', sinceLine);
    const token = new URL(extractUrl(inviteMail.body)).searchParams.get('token');
    expect(token).toBeTruthy();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Sign in' }).waitFor();

    await signInByMagicLink(page, inviteeEmail);

    const acceptRes = await page.request.post('http://localhost:3011/invitations/accept', {
      headers: { Origin: 'http://localhost:3100' },
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
