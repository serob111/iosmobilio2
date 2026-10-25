import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import sharp from 'sharp';
import { Redis } from 'ioredis';
import { createObjectStorageFromEnv, draftIconKey } from '@mobilio/storage';
import { server } from '../../test/mocks/server.js';
import { createApp } from '../create-app.js';

// Same fake-DNS approach as projects.integration.spec.ts — only this one host is faked,
// everything else (Postgres/Redis/MinIO on localhost) resolves for real.
const FAKE_SITE_HOST = 'drafts-itest.example';
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
  'drafts: anonymous create/edit + claim into an org (live Postgres + Redis + MinIO)',
  () => {
    let app: INestApplication;
    let mailLogFile: string;
    let redis: Redis;

    beforeAll(async () => {
      mailLogFile = join(tmpdir(), `mobilio-mail-log-drafts-${Date.now()}.ndjson`);
      process.env.MAIL_LOG_FILE = mailLogFile;

      app = await createApp();
      await app.init();

      redis = new Redis(process.env.REDIS_URL!);
      server.listen({ onUnhandledFrame: 'bypass' });
    });

    async function resetRateLimitBuckets(): Promise<void> {
      const keys = await redis.keys('*|/sign-in/magic-link');
      keys.push(...(await redis.keys('*|/magic-link/verify')));
      keys.push(...(await redis.keys('draft-rate-limit:*')));
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

    function mockSite(): void {
      server.use(
        http.get('https://drafts-itest.example/', () =>
          HttpResponse.text(
            `<html><head><title>Черновик Кафе</title><meta name="theme-color" content="#336699"></head>
           <body><nav><a href="/menu">Меню</a></nav></body></html>`,
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          ),
        ),
      );
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
      const signInRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/magic-link')
        .set('Origin', 'http://localhost:3000')
        .send({ email, callbackURL: 'http://localhost:3000/' });
      expect(signInRes.status).toBe(200);

      const magicLinkUrl = lastMailFor(email).body.match(/https?:\/\/\S+/)?.[0];
      if (!magicLinkUrl) throw new Error(`No URL in mail body for ${email}`);
      const verifyPath = magicLinkUrl.replace(/^https?:\/\/[^/]+/, '');

      const verifyRes = await request(app.getHttpServer()).get(verifyPath).expect(302);
      const cookie = verifyRes.headers['set-cookie'];
      if (!cookie) throw new Error('No session cookie set by magic-link verify');
      return Array.isArray(cookie) ? cookie : [cookie];
    }

    /** POST /drafts sets an httpOnly cookie supertest's agent won't resend by itself — pull it out to forward by hand. */
    function draftCookieFrom(res: request.Response): string {
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const match = cookies.find((c: string) => c.startsWith('mobilio_draft_token='));
      if (!match) throw new Error('No draft cookie set');
      return match.split(';')[0]!;
    }

    it('creates an anonymous draft, reads and edits it with the cookie, and a different/missing cookie sees nothing', async () => {
      mockSite();

      const createRes = await request(app.getHttpServer())
        .post('/drafts')
        .send({ url: 'https://drafts-itest.example/' })
        .expect(201);
      const cookie = draftCookieFrom(createRes);

      const meRes = await request(app.getHttpServer()).get('/drafts/me').set('Cookie', cookie).expect(200);
      expect(meRes.body.name).toBe('Черновик Кафе');
      expect(meRes.body.config.tabs).toEqual([{ title: 'Меню', icon: 'grid', path: '/menu' }]);

      const updatedConfig = { ...meRes.body.config, name: 'Переименованный Черновик' };
      const putRes = await request(app.getHttpServer())
        .put('/drafts/me')
        .set('Cookie', cookie)
        .send(updatedConfig)
        .expect(200);
      expect(putRes.body.name).toBe('Переименованный Черновик');

      const getAfterUpdate = await request(app.getHttpServer())
        .get('/drafts/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(getAfterUpdate.body.name).toBe('Переименованный Черновик');

      await request(app.getHttpServer()).get('/drafts/me').expect(404);
      await request(app.getHttpServer())
        .get('/drafts/me')
        .set('Cookie', 'mobilio_draft_token=0'.padEnd(71, '0'))
        .expect(404);
    });

    it('uploads a replacement icon and the icon endpoint redirects to a signed url that actually serves it', async () => {
      mockSite();
      const createRes = await request(app.getHttpServer())
        .post('/drafts')
        .send({ url: 'https://drafts-itest.example/' })
        .expect(201);
      const cookie = draftCookieFrom(createRes);

      const png = await sharp({
        create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 200, b: 30 } },
      })
        .png()
        .toBuffer();
      await request(app.getHttpServer())
        .post('/drafts/me/icon')
        .set('Cookie', cookie)
        .attach('icon', png, { filename: 'icon.png', contentType: 'image/png' })
        .expect(201);

      const iconRes = await request(app.getHttpServer())
        .get('/drafts/me/icon')
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

    it('rejects an icon upload over 2MB with 413 FILE_TOO_LARGE', async () => {
      mockSite();
      const createRes = await request(app.getHttpServer())
        .post('/drafts')
        .send({ url: 'https://drafts-itest.example/' })
        .expect(201);
      const cookie = draftCookieFrom(createRes);

      const oversized = Buffer.alloc(3 * 1024 * 1024, 1);
      const res = await request(app.getHttpServer())
        .post('/drafts/me/icon')
        .set('Cookie', cookie)
        .attach('icon', oversized, { filename: 'icon.png', contentType: 'image/png' });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('rate-limits POST /drafts by the real connection IP after 10 creations, ignoring a spoofed X-Forwarded-For (TRUST_PROXY_HOPS=0 by default)', async () => {
      mockSite();

      // A different spoofed X-Forwarded-For on every request — with no trusted proxy
      // hop configured, Express's request.ip ignores this header entirely, so every one
      // of these still resolves to the same real (loopback) connection IP and shares one
      // bucket. If spoofing worked, none of these would ever hit the limit.
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/drafts')
          .set('X-Forwarded-For', `203.0.113.${i}`)
          .send({ url: 'https://drafts-itest.example/' })
          .expect(201);
      }

      const blocked = await request(app.getHttpServer())
        .post('/drafts')
        .set('X-Forwarded-For', '203.0.113.250')
        .send({ url: 'https://drafts-itest.example/' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    describe('with TRUST_PROXY_HOPS=1 (a trusted reverse proxy in front, as in prod behind Caddy)', () => {
      let proxyApp: INestApplication;

      beforeAll(async () => {
        process.env.TRUST_PROXY_HOPS = '1';
        proxyApp = await createApp();
        await proxyApp.init();
      });

      afterAll(async () => {
        await proxyApp.close();
        delete process.env.TRUST_PROXY_HOPS;
      });

      it('shares the limit across different IPv6 addresses in the same /64, but gives a different /64 its own budget', async () => {
        mockSite();

        for (let i = 1; i <= 10; i++) {
          await request(proxyApp.getHttpServer())
            .post('/drafts')
            .set('X-Forwarded-For', `2001:db8:abcd:1::${i.toString(16)}`)
            .send({ url: 'https://drafts-itest.example/' })
            .expect(201);
        }

        const blocked = await request(proxyApp.getHttpServer())
          .post('/drafts')
          .set('X-Forwarded-For', '2001:db8:abcd:1::ff')
          .send({ url: 'https://drafts-itest.example/' });
        expect(blocked.status).toBe(429);

        const differentPrefix = await request(proxyApp.getHttpServer())
          .post('/drafts')
          .set('X-Forwarded-For', '2001:db8:abcd:2::1')
          .send({ url: 'https://drafts-itest.example/' });
        expect(differentPrefix.status).toBe(201);
      });
    });

    it('claims a draft into an org: moves config/icon into a new project and the draft stops existing', async () => {
      mockSite();
      const draftRes = await request(app.getHttpServer())
        .post('/drafts')
        .send({ url: 'https://drafts-itest.example/' })
        .expect(201);
      const draftCookie = draftCookieFrom(draftRes);

      const png = await sharp({
        create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();
      await request(app.getHttpServer())
        .post('/drafts/me/icon')
        .set('Cookie', draftCookie)
        .attach('icon', png, { filename: 'icon.png', contentType: 'image/png' })
        .expect(201);

      const sessionCookie = await signInByMagicLink(`itest-drafts-claim-${Date.now()}@example.com`);
      const me = await request(app.getHttpServer()).get('/me').set('Cookie', sessionCookie).expect(200);
      const orgId = me.body.organizations[0].id as string;

      const bothCookies = [...sessionCookie, draftCookie];
      const claimRes = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/drafts/claim`)
        .set('Cookie', bothCookies)
        .expect(201);
      const projectId = claimRes.body.id as string;
      expect(projectId).toBeTruthy();

      const projectRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects/${projectId}`)
        .set('Cookie', sessionCookie)
        .expect(200);
      expect(projectRes.body.config.name).toBe('Черновик Кафе');
      expect(projectRes.body.config.id).toBe(projectId);

      const projectIconRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects/${projectId}/icon`)
        .set('Cookie', sessionCookie)
        .redirects(0);
      expect(projectIconRes.status).toBe(302);
      const fetched = await fetch(projectIconRes.headers.location as string);
      expect(fetched.status).toBe(200);
      const bytes = Buffer.from(await fetched.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      // processIconImage always normalizes to 1024x1024 regardless of input size (see the
      // icon-upload test above) — claiming moves that already-processed object as-is.
      expect(meta.width).toBe(1024);

      await request(app.getHttpServer()).get('/drafts/me').set('Cookie', draftCookie).expect(404);

      const reclaimRes = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/drafts/claim`)
        .set('Cookie', bothCookies);
      expect(reclaimRes.status).toBe(404);
    });

    it('claims a draft whose icon object is missing: falls back to a generated avatar, no 500, no orphaned project', async () => {
      mockSite();
      const draftRes = await request(app.getHttpServer())
        .post('/drafts')
        .send({ url: 'https://drafts-itest.example/' })
        .expect(201);
      const draftCookie = draftCookieFrom(draftRes);

      // Simulates storage.get() failing — delete the draft's own icon object (the one
      // createDraft put during site analysis) before claiming it.
      const meRes = await request(app.getHttpServer()).get('/drafts/me').set('Cookie', draftCookie).expect(200);
      const draftId = meRes.body.id as string;
      const storage = createObjectStorageFromEnv();
      await storage.delete(draftIconKey(draftId));

      const sessionCookie = await signInByMagicLink(`itest-drafts-noicon-${Date.now()}@example.com`);
      const me = await request(app.getHttpServer()).get('/me').set('Cookie', sessionCookie).expect(200);
      const orgId = me.body.organizations[0].id as string;

      const claimRes = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/drafts/claim`)
        .set('Cookie', [...sessionCookie, draftCookie]);
      expect(claimRes.status).toBe(201);
      const projectId = claimRes.body.id as string;

      const projectIconRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects/${projectId}/icon`)
        .set('Cookie', sessionCookie)
        .redirects(0);
      expect(projectIconRes.status).toBe(302);
      const fetched = await fetch(projectIconRes.headers.location as string);
      expect(fetched.status).toBe(200);
    });

    it('claims exactly once under concurrency: 5 simultaneous claims of the same draft yield exactly one success', async () => {
      mockSite();
      const draftRes = await request(app.getHttpServer())
        .post('/drafts')
        .send({ url: 'https://drafts-itest.example/' })
        .expect(201);
      const draftCookie = draftCookieFrom(draftRes);

      const sessionCookie = await signInByMagicLink(`itest-drafts-race-${Date.now()}@example.com`);
      const me = await request(app.getHttpServer()).get('/me').set('Cookie', sessionCookie).expect(200);
      const orgId = me.body.organizations[0].id as string;
      const bothCookies = [...sessionCookie, draftCookie];

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app.getHttpServer()).post(`/orgs/${orgId}/drafts/claim`).set('Cookie', bothCookies),
        ),
      );

      const succeeded = results.filter((res) => res.status === 201);
      const notFound = results.filter((res) => res.status === 404);
      expect(succeeded).toHaveLength(1);
      expect(notFound).toHaveLength(4);

      const projectsRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects`)
        .set('Cookie', sessionCookie)
        .expect(200);
      expect(projectsRes.body).toHaveLength(1);
    });

    it('POST /orgs/:orgId/drafts/claim 404s without a draft cookie', async () => {
      const sessionCookie = await signInByMagicLink(`itest-drafts-noclaim-${Date.now()}@example.com`);
      const me = await request(app.getHttpServer()).get('/me').set('Cookie', sessionCookie).expect(200);
      const orgId = me.body.organizations[0].id as string;

      const res = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/drafts/claim`)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(404);
    });
  },
);
