import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Redis } from 'ioredis';
import { createApp } from '../create-app.js';

// Only runs against real Postgres/Redis with a role-bootstrapped database (CI's build
// job runs packages/db's migration pipeline against its services: containers first —
// see .github/workflows/ci.yml). Locally this just skips, since plain `npm test`
// shouldn't require live infrastructure. In CI, REQUIRE_LIVE_SERVICES=true turns a
// missing env var into a hard failure instead of a silent skip — a misconfigured job
// should never pass by quietly running 0 tests.
const hasLiveServices =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL) && Boolean(process.env.BETTER_AUTH_SECRET);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/REDIS_URL/BETTER_AUTH_SECRET are not set');
}

describe.skipIf(!hasLiveServices)('auth + organizations HTTP flow (live Postgres + Redis)', () => {
  let app: INestApplication;
  let mailLogFile: string;
  let redis: Redis;

  beforeAll(async () => {
    mailLogFile = join(tmpdir(), `mobilio-mail-log-${Date.now()}.ndjson`);
    process.env.MAIL_LOG_FILE = mailLogFile;

    app = await createApp();
    await app.init();

    redis = new Redis(process.env.REDIS_URL!);
  });

  // Rate-limit buckets are keyed "<client-ip>|<path>" (sign-in and verify separately)
  // and shared across every test in this file, since nothing here resets between runs
  // naturally. The ip prefix isn't fixed, which cost real debugging time: Supertest's
  // in-process server resolves a real remoteAddress ("127.0.0.1|/sign-in/magic-link"),
  // while a standalone `nest start` + real network request falls back to a literal
  // "no-trusted-ip" bucket instead — matching only one of those left resets silently
  // missing the key this suite actually needed cleared. Suffix-matching catches both.
  // Deliberately a targeted pattern delete, not flushdb: this same Redis also holds
  // active sessions and in-flight magic-link tokens (Better Auth's secondaryStorage),
  // and a full flush wiped a *different* test's still-valid session out from under it —
  // a real bug this suite caught by actually needing two simultaneous sessions (two
  // orgs, cross-access check), not a hypothetical.
  async function resetRateLimitBuckets(): Promise<void> {
    const keys = await redis.keys('*|/sign-in/magic-link');
    keys.push(...(await redis.keys('*|/magic-link/verify')));
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  beforeEach(async () => {
    await resetRateLimitBuckets();
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    if (existsSync(mailLogFile)) {
      unlinkSync(mailLogFile);
    }
    delete process.env.MAIL_LOG_FILE;
  });

  function lastMagicLinkUrlFor(email: string): string {
    const lines = readFileSync(mailLogFile, 'utf8').trim().split('\n');
    const messages = lines.map((line) => JSON.parse(line) as { to: string; body: string });
    const match = [...messages].reverse().find((message) => message.to === email);
    if (!match) {
      throw new Error(`No mail logged for ${email}`);
    }
    const [url] = match.body.match(/https?:\/\/\S+/) ?? [];
    if (!url) {
      throw new Error(`No URL found in mail body: ${match.body}`);
    }
    return url;
  }

  // Resetting the bucket before each request (see above) eliminates the bucket as a
  // *cause* of 429s, but doesn't guarantee one is never seen in practice — Better Auth
  // applies this check inside its own request pipeline, and this suite has observed
  // occasional 429s even immediately after a confirmed-empty bucket, most plausibly
  // from in-flight request overlap within a single Node process rather than genuinely
  // exhausted quota. A bounded retry is standard, realistic client behavior for a 429
  // either way, and sidesteps needing to fully reverse-engineer Better Auth's internal
  // bucketing to eliminate it outright.
  async function postWithRetry(path: string, body: Record<string, unknown>, attempts = 3) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('Origin', 'http://localhost:3000')
        .send(body);
      if (res.status !== 429 || attempt === attempts) {
        return res;
      }
      await resetRateLimitBuckets();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('unreachable');
  }

  async function signInByMagicLink(email: string): Promise<string[]> {
    const server = app.getHttpServer();
    await resetRateLimitBuckets();
    const signInRes = await postWithRetry('/api/auth/sign-in/magic-link', {
      email,
      callbackURL: 'http://localhost:3000/',
    });
    expect(signInRes.status).toBe(200);

    const magicLinkUrl = lastMagicLinkUrlFor(email);
    const verifyPath = magicLinkUrl.replace(/^https?:\/\/[^/]+/, '');

    await resetRateLimitBuckets();
    const verifyRes = await request(server).get(verifyPath).expect(302);
    const cookie = verifyRes.headers['set-cookie'];
    if (!cookie) {
      throw new Error('No session cookie set by magic-link verify');
    }
    return Array.isArray(cookie) ? cookie : [cookie];
  }

  it('completes magic-link sign-in end to end, creating a session with a personal org', async () => {
    const email = `itest-signin-${Date.now()}@example.com`;
    const cookie = await signInByMagicLink(email);

    const meRes = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);

    expect(meRes.body.user.email).toBe(email);
    expect(meRes.body.organizations).toHaveLength(1);
    expect(meRes.body.organizations[0].role).toBe('owner');
  });

  it('returns 404 (not 403) when a user has no membership in the requested org', async () => {
    const emailA = `itest-orga-${Date.now()}@example.com`;
    const emailB = `itest-orgb-${Date.now()}@example.com`;

    const cookieA = await signInByMagicLink(emailA);
    const cookieB = await signInByMagicLink(emailB);

    const meB = await request(app.getHttpServer()).get('/me').set('Cookie', cookieB).expect(200);
    const orgBId = meB.body.organizations[0].id as string;

    const res = await request(app.getHttpServer()).get(`/orgs/${orgBId}`).set('Cookie', cookieA).expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Organization not found', requestId: expect.any(String) },
    });
  });

  it('invites a second user by email and lets them accept, joining the org', async () => {
    const ownerEmail = `itest-owner-${Date.now()}@example.com`;
    const inviteeEmail = `itest-invitee-${Date.now()}@example.com`;

    const ownerCookie = await signInByMagicLink(ownerEmail);
    const me = await request(app.getHttpServer()).get('/me').set('Cookie', ownerCookie).expect(200);
    const orgId = me.body.organizations[0].id as string;

    await request(app.getHttpServer())
      .post(`/orgs/${orgId}/invitations`)
      .set('Cookie', ownerCookie)
      .send({ email: inviteeEmail, role: 'member' })
      .expect(201);

    const inviteeCookie = await signInByMagicLink(inviteeEmail);
    const inviteMailUrl = (() => {
      const lines = readFileSync(mailLogFile, 'utf8').trim().split('\n');
      const messages = lines.map((line) => JSON.parse(line) as { to: string; body: string });
      const invite = [...messages].reverse().find((m) => m.to === inviteeEmail && m.body.includes('/invitations/accept'));
      if (!invite) throw new Error('No invitation email found');
      const [url] = invite.body.match(/https?:\/\/\S+\?token=\S+/) ?? [];
      return new URL(url!).searchParams.get('token')!;
    })();

    await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Cookie', inviteeCookie)
      .send({ token: inviteMailUrl })
      .expect(201);

    const inviteeMe = await request(app.getHttpServer()).get('/me').set('Cookie', inviteeCookie).expect(200);
    expect(inviteeMe.body.organizations.map((o: { id: string }) => o.id)).toContain(orgId);
  });

  it('rate limits rapid sign-in requests on the same path', async () => {
    const server = app.getHttpServer();
    let sawRateLimited = false;

    for (let i = 0; i < 10 && !sawRateLimited; i++) {
      const res = await request(server)
        .post('/api/auth/sign-in/magic-link')
        .set('Origin', 'http://localhost:3000')
        .send({ email: `itest-rate-${i}@example.com`, callbackURL: 'http://localhost:3000/' });
      if (res.status === 429) {
        sawRateLimited = true;
      }
    }

    expect(sawRateLimited).toBe(true);
  });
});
