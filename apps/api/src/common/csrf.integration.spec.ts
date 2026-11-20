import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import sharp from 'sharp';
import { server } from '../../test/mocks/server.js';
import { createApp } from '../create-app.js';

// Same fake-DNS approach as drafts.integration.spec.ts/projects.integration.spec.ts —
// only this one host is faked, everything else (Postgres/Redis/MinIO on localhost)
// resolves for real.
const FAKE_SITE_HOST = 'csrf-itest.example';
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

const WEB_ORIGIN_UNDER_TEST = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

// Deliberately the one integration suite that does NOT set
// CSRF_DISABLED_FOR_TESTING — every other *.integration.spec.ts opts out of this
// check (it's orthogonal to what they're testing), so this file is what actually
// proves the real middleware works end to end.
describe.skipIf(!hasLiveServices)(
  'CSRF: Origin/Referer check on cookie-authorized routes (live Postgres + Redis + MinIO)',
  () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp();
      await app.init();
      // No listen()-time option needed — see test/msw-policy.ts for why, and for the
      // actual policy (every request now matches either this file's own handlers or
      // the shared catch-all baked into test/mocks/server.ts).
      server.listen();
    });

    afterAll(async () => {
      server.close();
      await app.close();
    });

    afterEach(() => server.resetHandlers());

    function mockSite(): void {
      server.use(
        http.get(`https://${FAKE_SITE_HOST}/`, () =>
          HttpResponse.text('<html><head><title>CSRF Test Site</title></head><body></body></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        ),
      );
    }

    function draftCookieFrom(res: request.Response): string {
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const match = cookies.find((c: string) => c.startsWith('mobilio_draft_token='));
      if (!match) throw new Error('No draft cookie set');
      return match.split(';')[0]!;
    }

    /** A fresh draft, created with the correct Origin (POST /drafts is itself a cookie-setting, non-excluded route). */
    async function createDraftCookie(): Promise<string> {
      mockSite();
      const res = await request(app.getHttpServer())
        .post('/drafts')
        .set('Origin', WEB_ORIGIN_UNDER_TEST)
        .send({ url: `https://${FAKE_SITE_HOST}/` })
        .expect(201);
      return draftCookieFrom(res);
    }

    it('rejects POST /drafts (a mutating, non-excluded route) from a foreign Origin', async () => {
      mockSite();
      const res = await request(app.getHttpServer())
        .post('/drafts')
        .set('Origin', 'https://evil.example')
        .send({ url: `https://${FAKE_SITE_HOST}/` });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
    });

    it('rejects PUT /drafts/me (draft-cookie-authorized) from a foreign Origin', async () => {
      const cookie = await createDraftCookie();

      const res = await request(app.getHttpServer())
        .put('/drafts/me')
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.example')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
    });

    it('rejects PUT /drafts/me with neither an Origin nor a Referer header', async () => {
      const cookie = await createDraftCookie();

      const res = await request(app.getHttpServer()).put('/drafts/me').set('Cookie', cookie).send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
    });

    it('allows PUT /drafts/me with the correct Origin', async () => {
      const cookie = await createDraftCookie();
      const meRes = await request(app.getHttpServer()).get('/drafts/me').set('Cookie', cookie).expect(200);
      const updatedConfig = { ...meRes.body.config, name: 'Renamed via CSRF test' };

      const res = await request(app.getHttpServer())
        .put('/drafts/me')
        .set('Cookie', cookie)
        .set('Origin', WEB_ORIGIN_UNDER_TEST)
        .send(updatedConfig)
        .expect(200);

      expect(res.body.name).toBe('Renamed via CSRF test');
    });

    it('falls back to a matching Referer when Origin is absent', async () => {
      const cookie = await createDraftCookie();
      const meRes = await request(app.getHttpServer()).get('/drafts/me').set('Cookie', cookie).expect(200);
      const updatedConfig = { ...meRes.body.config, name: 'Renamed via Referer fallback' };

      const res = await request(app.getHttpServer())
        .put('/drafts/me')
        .set('Cookie', cookie)
        .set('Referer', `${WEB_ORIGIN_UNDER_TEST}/try`)
        .send(updatedConfig)
        .expect(200);

      expect(res.body.name).toBe('Renamed via Referer fallback');
    });

    // The icon upload is the case called out explicitly: multipart/form-data is a CORS
    // "simple request" that never triggers a preflight, so the browser's own CORS
    // machinery provides no protection here at all — this middleware is the only thing
    // standing between a cross-site <form> and a forged icon upload.
    it('rejects the multipart icon upload (POST /drafts/me/icon) from a foreign Origin', async () => {
      const cookie = await createDraftCookie();

      const res = await request(app.getHttpServer())
        .post('/drafts/me/icon')
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.example')
        .attach('icon', Buffer.from('not actually decoded, rejected before that'), {
          filename: 'icon.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
    });

    it('allows the multipart icon upload (POST /drafts/me/icon) with the correct Origin', async () => {
      const cookie = await createDraftCookie();
      const png = await sharp({
        create: { width: 20, height: 20, channels: 3, background: { r: 5, g: 6, b: 7 } },
      })
        .png()
        .toBuffer();

      await request(app.getHttpServer())
        .post('/drafts/me/icon')
        .set('Cookie', cookie)
        .set('Origin', WEB_ORIGIN_UNDER_TEST)
        .attach('icon', png, { filename: 'icon.png', contentType: 'image/png' })
        .expect(201);
    });

    // BuildRunnerGuard-protected routes are Bearer-authorized, never by a cookie — a
    // forged cross-site request can't attach an Authorization header the way it can a
    // cookie, so there's nothing for an Origin check to defend here. Using an invalid
    // token (rather than wiring up a whole real build) is enough to prove the request
    // reaches BuildRunnerGuard at all instead of being short-circuited by CSRF: a
    // CSRF_ORIGIN_MISMATCH would mean this middleware ran; BUILD_NOT_FOUND means it let
    // the request through and the *guard* rejected it for an unrelated reason.
    it('does not subject the Bearer-authorized build runner routes to the Origin check', async () => {
      const res = await request(app.getHttpServer())
        .post('/builds/00000000-0000-0000-0000-000000000000/fail')
        .set('Authorization', 'Bearer not-a-real-token')
        .send({ error: 'irrelevant' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BUILD_NOT_FOUND');
    });
  },
);
