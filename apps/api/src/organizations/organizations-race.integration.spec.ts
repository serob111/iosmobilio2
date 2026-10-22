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

describe.skipIf(!hasLiveServices)('organizations races + edge cases (live Postgres + Redis)', () => {
  let app: INestApplication;
  let mailLogFile: string;
  let redis: Redis;

  beforeAll(async () => {
    mailLogFile = join(tmpdir(), `mobilio-mail-log-race-${Date.now()}.ndjson`);
    process.env.MAIL_LOG_FILE = mailLogFile;

    app = await createApp();
    await app.init();

    redis = new Redis(process.env.REDIS_URL!);
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    if (existsSync(mailLogFile)) {
      unlinkSync(mailLogFile);
    }
    delete process.env.MAIL_LOG_FILE;
  });

  // See auth-flow.integration.spec.ts for why this is suffix-matched rather than a
  // single hardcoded key, and why it's a targeted delete rather than flushdb.
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

  function lastMailFor(email: string, bodyIncludes?: string): { to: string; subject: string; body: string } {
    const lines = readFileSync(mailLogFile, 'utf8').trim().split('\n');
    const messages = lines.map((line) => JSON.parse(line) as { to: string; subject: string; body: string });
    const match = [...messages].reverse().find((m) => m.to === email && (!bodyIncludes || m.body.includes(bodyIncludes)));
    if (!match) {
      throw new Error(`No mail logged for ${email}${bodyIncludes ? ` containing "${bodyIncludes}"` : ''}`);
    }
    return match;
  }

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

    const magicLinkUrl = lastMailFor(email).body.match(/https?:\/\/\S+/)?.[0];
    if (!magicLinkUrl) throw new Error(`No URL in mail body for ${email}`);
    const verifyPath = magicLinkUrl.replace(/^https?:\/\/[^/]+/, '');

    await resetRateLimitBuckets();
    const verifyRes = await request(server).get(verifyPath).expect(302);
    const cookie = verifyRes.headers['set-cookie'];
    if (!cookie) {
      throw new Error('No session cookie set by magic-link verify');
    }
    return Array.isArray(cookie) ? cookie : [cookie];
  }

  it('GET /orgs/:orgId returns a 404 in the unified error format when orgId is not a uuid', async () => {
    const cookie = await signInByMagicLink(`itest-uuid-${Date.now()}@example.com`);

    const res = await request(app.getHttpServer()).get('/orgs/not-a-uuid').set('Cookie', cookie).expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Organization not found', requestId: expect.any(String) },
    });
  });

  it('exactly one of two concurrent last-owner demotions succeeds; the org keeps an owner', async () => {
    const ownerEmail = `itest-race-owner-${Date.now()}@example.com`;
    const secondOwnerEmail = `itest-race-second-${Date.now()}@example.com`;
    const actorEmail = `itest-race-actor-${Date.now()}@example.com`;

    const ownerCookie = await signInByMagicLink(ownerEmail);
    const me = await request(app.getHttpServer()).get('/me').set('Cookie', ownerCookie).expect(200);
    const orgId = me.body.organizations[0].id as string;
    const ownerId = me.body.user.id as string;

    async function inviteAndAccept(email: string, role: 'owner' | 'admin'): Promise<{ id: string; cookie: string[] }> {
      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/invitations`)
        .set('Cookie', ownerCookie)
        .send({ email, role })
        .expect(201);

      const cookie = await signInByMagicLink(email);
      const token = new URL(lastMailFor(email, '/invitations/accept').body.match(/https?:\/\/\S+\?token=\S+/)![0]).searchParams.get(
        'token',
      )!;
      await request(app.getHttpServer()).post('/invitations/accept').set('Cookie', cookie).send({ token }).expect(201);
      const whoAmI = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
      return { id: whoAmI.body.user.id as string, cookie };
    }

    // Two owners (A, second) plus a third member with 'admin' role who acts as both
    // demotions' caller. The actor's own role never changes mid-race, which matters:
    // an earlier version of this test had each owner demote the *other*, and the first
    // commit flipped the second caller's own role before their request's RoleGuard
    // check even ran — a 403 (insufficient role), not the 409 this test is actually
    // about. Using a third-party admin actor isolates the race to assertNotLastOwner.
    const { id: secondOwnerId } = await inviteAndAccept(secondOwnerEmail, 'owner');
    const { cookie: actorCookie } = await inviteAndAccept(actorEmail, 'admin');

    // Org now has exactly two owners (ownerId, secondOwnerId) and one admin (actor).
    // The admin demotes both owners to 'member' at the same time — if both succeeded,
    // the org would end up with zero owners.
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/orgs/${orgId}/members/${ownerId}`)
        .set('Cookie', actorCookie)
        .send({ role: 'member' }),
      request(app.getHttpServer())
        .patch(`/orgs/${orgId}/members/${secondOwnerId}`)
        .set('Cookie', actorCookie)
        .send({ role: 'member' }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflictRes = resA.status === 409 ? resA : resB;
    expect(conflictRes.body).toEqual({
      error: { code: 'LAST_OWNER', message: expect.any(String), requestId: expect.any(String) },
    });

    const orgAfter = await request(app.getHttpServer()).get(`/orgs/${orgId}`).set('Cookie', ownerCookie).expect(200);
    const owners = (orgAfter.body.members as Array<{ role: string }>).filter((m) => m.role === 'owner');
    expect(owners).toHaveLength(1);
  });

  it('two concurrent accepts of the same invitation never 500, and create exactly one membership', async () => {
    const ownerEmail = `itest-dup-owner-${Date.now()}@example.com`;
    const inviteeEmail = `itest-dup-invitee-${Date.now()}@example.com`;

    const ownerCookie = await signInByMagicLink(ownerEmail);
    const me = await request(app.getHttpServer()).get('/me').set('Cookie', ownerCookie).expect(200);
    const orgId = me.body.organizations[0].id as string;

    await request(app.getHttpServer())
      .post(`/orgs/${orgId}/invitations`)
      .set('Cookie', ownerCookie)
      .send({ email: inviteeEmail, role: 'member' })
      .expect(201);

    const inviteeCookie = await signInByMagicLink(inviteeEmail);
    const me2 = await request(app.getHttpServer()).get('/me').set('Cookie', inviteeCookie).expect(200);
    const inviteeId = me2.body.user.id as string;

    const token = new URL(lastMailFor(inviteeEmail, '/invitations/accept').body.match(/https?:\/\/\S+\?token=\S+/)![0])
      .searchParams.get('token')!;

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer()).post('/invitations/accept').set('Cookie', inviteeCookie).send({ token }),
      request(app.getHttpServer()).post('/invitations/accept').set('Cookie', inviteeCookie).send({ token }),
    ]);

    expect(res1.status).toBeLessThan(500);
    expect(res2.status).toBeLessThan(500);

    const orgAfter = await request(app.getHttpServer()).get(`/orgs/${orgId}`).set('Cookie', ownerCookie).expect(200);
    const inviteeMemberships = (orgAfter.body.members as Array<{ userId: string }>).filter(
      (m) => m.userId === inviteeId,
    );
    expect(inviteeMemberships).toHaveLength(1);
  });
});
