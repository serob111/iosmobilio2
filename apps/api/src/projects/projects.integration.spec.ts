import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import sharp from 'sharp';
import { Redis } from 'ioredis';
import { server } from '../../test/mocks/server.js';
import { createApp } from '../create-app.js';

// Partial mock, not a full one (unlike analyze-site.spec.ts) — this file also connects
// to real Postgres/Redis via "localhost", which still needs real DNS/loopback
// resolution to work. Only the fake site-analysis domain below is faked; everything
// else passes through to the real resolver.
const FAKE_SITE_HOST = 'projects-itest.example';
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: ((hostname: string, options: unknown) =>
      hostname === FAKE_SITE_HOST
        ? Promise.resolve([{ address: '93.184.216.34', family: 4 }])
        : actual.lookup(hostname, options as never)) as typeof actual.lookup,
  };
});

// Only runs against real Postgres/Redis/MinIO (CI's build job provisions all three —
// see .github/workflows/ci.yml). Locally this just skips. In CI, REQUIRE_LIVE_SERVICES=true
// turns a missing env var into a hard failure instead of a silent skip.
const hasLiveServices =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.REDIS_URL) &&
  Boolean(process.env.BETTER_AUTH_SECRET) &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_BUCKET) &&
  Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error(
    'REQUIRE_LIVE_SERVICES=true but DATABASE_URL/REDIS_URL/BETTER_AUTH_SECRET/S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not all set',
  );
}

describe.skipIf(!hasLiveServices)(
  'projects CRUD + icon upload (live Postgres + Redis + MinIO)',
  () => {
    let app: INestApplication;
    let mailLogFile: string;
    let redis: Redis;

    beforeAll(async () => {
      mailLogFile = join(tmpdir(), `mobilio-mail-log-projects-${Date.now()}.ndjson`);
      process.env.MAIL_LOG_FILE = mailLogFile;

      app = await createApp();
      await app.init();

      redis = new Redis(process.env.REDIS_URL!);

      // bypass, not error: this file's own requests to the live NestJS app (via supertest)
      // don't match any registered handler below and must pass through untouched — only
      // analyzeSite's one external fetch to the fake site url is actually mocked.
      server.listen({ onUnhandledFrame: 'bypass' });
    });

    // See auth-flow.integration.spec.ts for why this is suffix-matched rather than a
    // single hardcoded key, and why it's a targeted delete rather than flushdb. This file
    // signs in multiple times per test now (the SSRF cases each sign in once too) and
    // needs the same reset auth-flow/organizations-race already established.
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
      server.close();
      await app.close();
      await redis.quit();
      if (existsSync(mailLogFile)) {
        unlinkSync(mailLogFile);
      }
      delete process.env.MAIL_LOG_FILE;
    });

    afterEach(() => server.resetHandlers());

    async function postWithRetry(path: string, body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .post(path)
        .set('Origin', 'http://localhost:3000')
        .send(body);
    }

    function lastMailFor(email: string): { to: string; subject: string; body: string } {
      const lines = readFileSync(mailLogFile, 'utf8').trim().split('\n');
      const messages = lines.map(
        (line) => JSON.parse(line) as { to: string; subject: string; body: string },
      );
      const match = [...messages].reverse().find((m) => m.to === email);
      if (!match) throw new Error(`No mail logged for ${email}`);
      return match;
    }

    async function signInByMagicLink(email: string): Promise<string[]> {
      const signInRes = await postWithRetry('/api/auth/sign-in/magic-link', {
        email,
        callbackURL: 'http://localhost:3000/',
      });
      expect(signInRes.status).toBe(200);

      const magicLinkUrl = lastMailFor(email).body.match(/https?:\/\/\S+/)?.[0];
      if (!magicLinkUrl) throw new Error(`No URL in mail body for ${email}`);
      const verifyPath = magicLinkUrl.replace(/^https?:\/\/[^/]+/, '');

      const verifyRes = await request(app.getHttpServer()).get(verifyPath).expect(302);
      const cookie = verifyRes.headers['set-cookie'];
      if (!cookie) throw new Error('No session cookie set by magic-link verify');
      return Array.isArray(cookie) ? cookie : [cookie];
    }

    function mockSite(): void {
      server.use(
        http.get('https://projects-itest.example/', () =>
          HttpResponse.text(
            `<html><head><title>Тест Кафе</title><meta name="theme-color" content="#336699"></head>
           <body><nav><a href="/menu">Меню</a></nav></body></html>`,
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          ),
        ),
      );
    }

    it('creates, reads, updates a project, and the created org can see it', async () => {
      mockSite();

      const cookie = await signInByMagicLink(`itest-projects-${Date.now()}@example.com`);
      const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
      const orgId = me.body.organizations[0].id as string;

      const createRes = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/projects`)
        .set('Cookie', cookie)
        .send({ url: 'https://projects-itest.example/' })
        .expect(201);
      const projectId = createRes.body.id as string;
      expect(projectId).toBeTruthy();

      const listRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects`)
        .set('Cookie', cookie)
        .expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(projectId);

      const getRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects/${projectId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(getRes.body.config.name).toBe('Тест Кафе');
      expect(getRes.body.config.tabs).toEqual([{ title: 'Меню', icon: 'grid', path: '/menu' }]);

      const updatedConfig = { ...getRes.body.config, name: 'Переименованное Кафе' };
      const putRes = await request(app.getHttpServer())
        .put(`/orgs/${orgId}/projects/${projectId}`)
        .set('Cookie', cookie)
        .send(updatedConfig)
        .expect(200);
      expect(putRes.body.name).toBe('Переименованное Кафе');

      const getAfterUpdate = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects/${projectId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(getAfterUpdate.body.config.name).toBe('Переименованное Кафе');
    });

    it('uploads a replacement icon and the icon endpoint redirects to a signed url that actually serves it', async () => {
      mockSite();
      const cookie = await signInByMagicLink(`itest-projects-icon-${Date.now()}@example.com`);
      const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
      const orgId = me.body.organizations[0].id as string;

      const createRes = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/projects`)
        .set('Cookie', cookie)
        .send({ url: 'https://projects-itest.example/' })
        .expect(201);
      const projectId = createRes.body.id as string;

      const png = await sharp({
        create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 200, b: 30 } },
      })
        .png()
        .toBuffer();
      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/projects/${projectId}/icon`)
        .set('Cookie', cookie)
        .attach('icon', png, { filename: 'icon.png', contentType: 'image/png' })
        .expect(201);

      const iconRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects/${projectId}/icon`)
        .set('Cookie', cookie)
        .redirects(0);
      expect(iconRes.status).toBe(302);

      const fetched = await fetch(iconRes.headers.location as string);
      expect(fetched.status).toBe(200);
      const bytes = Buffer.from(await fetched.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect(meta.width).toBe(1024);
      expect(meta.height).toBe(1024);
    });

    it.each(['http://minio:9000', 'http://localhost:3000', 'http://169.254.169.254'])(
      'POST /orgs/:orgId/projects with %s is rejected with 400 UNSAFE_URL and never makes a real request',
      async (unsafeUrl) => {
        const cookie = await signInByMagicLink(
          `itest-projects-ssrf-${Date.now()}-${Math.random()}@example.com`,
        );
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
        const orgId = me.body.organizations[0].id as string;

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const res = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects`)
          .set('Cookie', cookie)
          .send({ url: unsafeUrl })
          .expect(400);

        expect(res.body).toEqual({
          error: { code: 'UNSAFE_URL', message: expect.any(String), requestId: expect.any(String) },
        });
        // Rejected by safeFetch's own validation (port/no-dot-host/ip-range checks) before
        // any network call — proven here rather than assumed, since this is the one thing
        // that actually matters for SSRF: not that the error code is right, but that no
        // socket was ever opened toward the forbidden target.
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      },
    );

    it('GET /orgs/:orgId/projects/:projectId 404s for a project from a different org', async () => {
      mockSite();
      const cookieA = await signInByMagicLink(`itest-projects-a-${Date.now()}@example.com`);
      const meA = await request(app.getHttpServer()).get('/me').set('Cookie', cookieA).expect(200);
      const orgAId = meA.body.organizations[0].id as string;
      const createRes = await request(app.getHttpServer())
        .post(`/orgs/${orgAId}/projects`)
        .set('Cookie', cookieA)
        .send({ url: 'https://projects-itest.example/' })
        .expect(201);
      const projectId = createRes.body.id as string;

      const cookieB = await signInByMagicLink(`itest-projects-b-${Date.now()}@example.com`);
      const meB = await request(app.getHttpServer()).get('/me').set('Cookie', cookieB).expect(200);
      const orgBId = meB.body.organizations[0].id as string;

      const res = await request(app.getHttpServer())
        .get(`/orgs/${orgBId}/projects/${projectId}`)
        .set('Cookie', cookieB)
        .expect(404);
      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Project not found', requestId: expect.any(String) },
      });
    });
  },
);
