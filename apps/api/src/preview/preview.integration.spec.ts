import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { Redis } from 'ioredis';
import { createDb, schema, eq, runInTenantContext, runInTokenLookupContext, getTenantDb } from '@mobilio/db';
import { server } from '../../test/mocks/server.js';
import { createApp } from '../create-app.js';

const FAKE_SITE_HOST = 'preview-itest.example';
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
  Boolean(process.env.MIGRATOR_DATABASE_URL) &&
  Boolean(process.env.REDIS_URL) &&
  Boolean(process.env.BETTER_AUTH_SECRET) &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_BUCKET) &&
  Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error(
    'REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL/REDIS_URL/BETTER_AUTH_SECRET/' +
      'S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not all set',
  );
}

describe.skipIf(!hasLiveServices)(
  'preview links: create/rotate/revoke + GET /preview/:slug (live Postgres + Redis + MinIO)',
  () => {
    let app: INestApplication;
    let mailLogFile: string;
    let redis: Redis;
    let migrator: ReturnType<typeof createDb>;

    beforeAll(async () => {
      mailLogFile = join(tmpdir(), `mobilio-mail-log-preview-${Date.now()}.ndjson`);
      process.env.MAIL_LOG_FILE = mailLogFile;
      process.env.BUILD_RUNNER = 'fake';
      // This suite is about preview links, not CSRF — see csrf.integration.spec.ts.
      process.env.CSRF_DISABLED_FOR_TESTING = 'true';

      app = await createApp();
      await app.init();

      redis = new Redis(process.env.REDIS_URL!);
      migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
      server.listen({ onUnhandledFrame: 'bypass' });
    });

    async function resetRateLimitBuckets(): Promise<void> {
      const keys = await redis.keys('*|/sign-in/magic-link');
      keys.push(...(await redis.keys('*|/magic-link/verify')));
      // draft-rate-limit:* (DraftRateLimitService, 10 POST /drafts per 10 minutes) is
      // also per-client and shared across every test in this file (and every other file
      // in the same vitest run — fileParallelism:false means they all run in one
      // process) — the draft-backed describe block alone calls POST /drafts five times.
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
      await migrator.pool.end();
      if (existsSync(mailLogFile)) {
        unlinkSync(mailLogFile);
      }
      delete process.env.MAIL_LOG_FILE;
      delete process.env.BUILD_RUNNER;
      delete process.env.CSRF_DISABLED_FOR_TESTING;
    });

    afterEach(() => server.resetHandlers());

    function mockSite(): void {
      server.use(
        http.get('https://preview-itest.example/', () =>
          HttpResponse.text(
            `<html><head><title>Preview Test Cafe</title><meta name="theme-color" content="#336699"></head>
           <body><nav><a href="/menu">Menu</a></nav></body></html>`,
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          ),
        ),
      );
    }

    function lastMailFor(email: string): { to: string; subject: string; body: string } {
      const lines = readFileSync(mailLogFile, 'utf8').trim().split('\n');
      const messages = lines.map((line) => JSON.parse(line) as { to: string; subject: string; body: string });
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

    function draftCookieFrom(res: request.Response): string {
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const match = cookies.find((c: string) => c.startsWith('mobilio_draft_token='));
      if (!match) throw new Error('No draft cookie set');
      return match.split(';')[0]!;
    }

    function slugFromUrl(url: string): string {
      return url.split('/preview/')[1]!;
    }

    describe('project-backed link', () => {
      it('creates a share link, serves only the allowed fields via GET /preview/:slug, and regenerating revokes the old one', async () => {
        mockSite();
        const cookie = await signInByMagicLink(`itest-preview-project-${Date.now()}@example.com`);
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
        const orgId = me.body.organizations[0].id as string;

        const createRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects`)
          .set('Cookie', cookie)
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const projectId = createRes.body.id as string;

        const linkRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(201);
        const firstSlug = slugFromUrl(linkRes.body.url as string);

        const previewRes = await request(app.getHttpServer()).get(`/preview/${firstSlug}`).expect(200);
        expect(previewRes.body.name).toBe('Preview Test Cafe');
        expect(previewRes.body.tabs).toEqual([{ title: 'Menu', icon: 'grid', path: '/menu' }]);
        expect(previewRes.body.theme).toMatchObject({ primary: '#336699' });
        expect(previewRes.body.statusBar).toBeDefined();
        expect(typeof previewRes.body.iconUrl).toBe('string');
        expect(typeof previewRes.body.proxyBase).toBe('string');
        expect(previewRes.body.proxyBase).toContain(firstSlug);
        // Only the allow-listed fields — never org/project ids or raw config.
        expect(Object.keys(previewRes.body).sort()).toEqual(
          ['iconUrl', 'name', 'proxyBase', 'statusBar', 'tabs', 'theme'].sort(),
        );
        expect(previewRes.body.id).toBeUndefined();
        expect(previewRes.body.orgId).toBeUndefined();
        expect(previewRes.body.projectId).toBeUndefined();

        const regenerateRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/preview-link/regenerate`)
          .set('Cookie', cookie)
          .expect(201);
        const secondSlug = slugFromUrl(regenerateRes.body.url as string);
        expect(secondSlug).not.toBe(firstSlug);

        await request(app.getHttpServer()).get(`/preview/${firstSlug}`).expect(404);
        await request(app.getHttpServer()).get(`/preview/${secondSlug}`).expect(200);
      });

      it('POST .../preview-link is idempotent (returns the existing active link, never a second one) while one is active', async () => {
        mockSite();
        const cookie = await signInByMagicLink(`itest-preview-idempotent-${Date.now()}@example.com`);
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
        const orgId = me.body.organizations[0].id as string;
        const createRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects`)
          .set('Cookie', cookie)
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const projectId = createRes.body.id as string;

        const firstRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(201);
        const secondRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(201);
        expect(secondRes.body.url).toBe(firstRes.body.url);

        // GET redisplays the exact same, still-active link — not a fresh one.
        const getRes = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(200);
        expect(getRes.body.url).toBe(firstRes.body.url);
      });

      it('a broken active share link (undecryptable slug_enc, e.g. after a PREVIEW_SLUG_KEY rotation) 404s on GET and is transparently replaced on POST', async () => {
        mockSite();
        const cookie = await signInByMagicLink(`itest-preview-broken-${Date.now()}@example.com`);
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
        const orgId = me.body.organizations[0].id as string;
        const userId = me.body.user.id as string;
        const createRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects`)
          .set('Cookie', cookie)
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const projectId = createRes.body.id as string;

        const firstRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(201);
        const firstSlug = slugFromUrl(firstRes.body.url as string);

        // Simulates a PREVIEW_SLUG_KEY rotation: the row is still active (not revoked),
        // but its slug_enc can no longer be decrypted with the key the running api has —
        // 40 bytes is long enough to pass decryptPreviewSlug's length check and reach
        // the actual GCM auth-tag verification, which then fails for real.
        await runInTenantContext(migrator.db, { orgId, userId }, () =>
          getTenantDb()
            .update(schema.previewLinks)
            .set({ slugEnc: Buffer.alloc(40, 1).toString('base64') })
            .where(eq(schema.previewLinks.projectId, projectId)),
        );

        const getRes = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(404);
        expect(getRes.body.error.code).toBe('PREVIEW_LINK_NOT_FOUND');

        // POST transparently revokes the broken row and creates a working replacement —
        // never a 500, and the old (now-broken) slug no longer resolves either.
        const postRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(201);
        const newSlug = slugFromUrl(postRes.body.url as string);
        expect(newSlug).not.toBe(firstSlug);
        await request(app.getHttpServer()).get(`/preview/${newSlug}`).expect(200);

        const confirmRes = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(200);
        expect(confirmRes.body.url).toBe(postRes.body.url);
      });

      it('two concurrent POST .../preview-link calls for the same project return the same url and never 500', async () => {
        mockSite();
        const cookie = await signInByMagicLink(`itest-preview-race-${Date.now()}@example.com`);
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
        const orgId = me.body.organizations[0].id as string;
        const createRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects`)
          .set('Cookie', cookie)
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const projectId = createRes.body.id as string;

        const [resA, resB] = await Promise.all([
          request(app.getHttpServer()).post(`/orgs/${orgId}/projects/${projectId}/preview-link`).set('Cookie', cookie),
          request(app.getHttpServer()).post(`/orgs/${orgId}/projects/${projectId}/preview-link`).set('Cookie', cookie),
        ]);

        expect(resA.status).toBe(201);
        expect(resB.status).toBe(201);
        expect(resA.body.url).toBe(resB.body.url);
      });

      it('GET .../preview-link 404s (PREVIEW_LINK_NOT_FOUND) when no share link has been created yet', async () => {
        mockSite();
        const cookie = await signInByMagicLink(`itest-preview-get-none-${Date.now()}@example.com`);
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
        const orgId = me.body.organizations[0].id as string;
        const createRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects`)
          .set('Cookie', cookie)
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const projectId = createRes.body.id as string;

        const getRes = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(404);
        expect(getRes.body.error.code).toBe('PREVIEW_LINK_NOT_FOUND');
      });

      it('opening the editor (POST .../preview-link/editor) repeatedly never revokes the active share link', async () => {
        mockSite();
        const cookie = await signInByMagicLink(`itest-preview-editor-isolation-${Date.now()}@example.com`);
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
        const orgId = me.body.organizations[0].id as string;
        const createRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects`)
          .set('Cookie', cookie)
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const projectId = createRes.body.id as string;

        const shareRes = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(201);
        const shareSlug = slugFromUrl(shareRes.body.url as string);

        // Simulates opening the editor page three times (three separate page loads) —
        // each one must get its own fresh, independently-valid editor link, and none of
        // them may touch the share link above.
        const editorSlugs: string[] = [];
        for (let i = 0; i < 3; i++) {
          const editorRes = await request(app.getHttpServer())
            .post(`/orgs/${orgId}/projects/${projectId}/preview-link/editor`)
            .set('Cookie', cookie)
            .expect(201);
          editorSlugs.push(slugFromUrl(editorRes.body.url as string));
        }
        expect(new Set(editorSlugs).size).toBe(3);

        for (const slug of editorSlugs) {
          await request(app.getHttpServer()).get(`/preview/${slug}`).expect(200);
        }
        // The share link the user may already have copied/sent is still alive.
        await request(app.getHttpServer()).get(`/preview/${shareSlug}`).expect(200);
        const stillActive = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/preview-link`)
          .set('Cookie', cookie)
          .expect(200);
        expect(stillActive.body.url).toBe(shareRes.body.url);
      });

      it('404s creating a preview link for a project the caller\'s org does not own', async () => {
        mockSite();
        const ownerCookie = await signInByMagicLink(`itest-preview-owner-${Date.now()}@example.com`);
        const ownerMe = await request(app.getHttpServer()).get('/me').set('Cookie', ownerCookie).expect(200);
        const ownerOrgId = ownerMe.body.organizations[0].id as string;
        const createRes = await request(app.getHttpServer())
          .post(`/orgs/${ownerOrgId}/projects`)
          .set('Cookie', ownerCookie)
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const projectId = createRes.body.id as string;

        const otherCookie = await signInByMagicLink(`itest-preview-other-${Date.now()}@example.com`);
        const otherMe = await request(app.getHttpServer()).get('/me').set('Cookie', otherCookie).expect(200);
        const otherOrgId = otherMe.body.organizations[0].id as string;

        await request(app.getHttpServer())
          .post(`/orgs/${otherOrgId}/projects/${projectId}/preview-link`)
          .set('Cookie', otherCookie)
          .expect(404);
      });
    });

    describe('draft-backed link', () => {
      it('creates a share link for an anonymous draft and serves it the same way', async () => {
        mockSite();
        const draftRes = await request(app.getHttpServer())
          .post('/drafts')
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const draftCookie = draftCookieFrom(draftRes);

        const linkRes = await request(app.getHttpServer())
          .post('/drafts/me/preview-link')
          .set('Cookie', draftCookie)
          .expect(201);
        const slug = slugFromUrl(linkRes.body.url as string);

        const previewRes = await request(app.getHttpServer()).get(`/preview/${slug}`).expect(200);
        expect(previewRes.body.name).toBe('Preview Test Cafe');
        expect(previewRes.body.projectId).toBeUndefined();
        expect(previewRes.body.draftId).toBeUndefined();
      });

      it('opening the editor repeatedly never revokes the draft\'s active share link, and regenerate explicitly does', async () => {
        mockSite();
        const draftRes = await request(app.getHttpServer())
          .post('/drafts')
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const draftCookie = draftCookieFrom(draftRes);

        const shareRes = await request(app.getHttpServer())
          .post('/drafts/me/preview-link')
          .set('Cookie', draftCookie)
          .expect(201);
        const shareSlug = slugFromUrl(shareRes.body.url as string);

        const editorRes1 = await request(app.getHttpServer())
          .post('/drafts/me/preview-link/editor')
          .set('Cookie', draftCookie)
          .expect(201);
        const editorRes2 = await request(app.getHttpServer())
          .post('/drafts/me/preview-link/editor')
          .set('Cookie', draftCookie)
          .expect(201);
        expect(editorRes1.body.url).not.toBe(editorRes2.body.url);
        await request(app.getHttpServer()).get(`/preview/${slugFromUrl(editorRes1.body.url as string)}`).expect(200);
        await request(app.getHttpServer()).get(`/preview/${slugFromUrl(editorRes2.body.url as string)}`).expect(200);
        // Still alive after two editor-link creations.
        await request(app.getHttpServer()).get(`/preview/${shareSlug}`).expect(200);

        const regenerateRes = await request(app.getHttpServer())
          .post('/drafts/me/preview-link/regenerate')
          .set('Cookie', draftCookie)
          .expect(201);
        const newShareSlug = slugFromUrl(regenerateRes.body.url as string);
        expect(newShareSlug).not.toBe(shareSlug);
        // Regenerate, unlike the editor endpoint, does revoke the old share link.
        await request(app.getHttpServer()).get(`/preview/${shareSlug}`).expect(404);
        await request(app.getHttpServer()).get(`/preview/${newShareSlug}`).expect(200);
      });

      it('dies the moment the draft is claimed into an org', async () => {
        mockSite();
        const draftRes = await request(app.getHttpServer())
          .post('/drafts')
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const draftCookie = draftCookieFrom(draftRes);

        const linkRes = await request(app.getHttpServer())
          .post('/drafts/me/preview-link')
          .set('Cookie', draftCookie)
          .expect(201);
        const slug = slugFromUrl(linkRes.body.url as string);
        await request(app.getHttpServer()).get(`/preview/${slug}`).expect(200);

        const sessionCookie = await signInByMagicLink(`itest-preview-claim-${Date.now()}@example.com`);
        const me = await request(app.getHttpServer()).get('/me').set('Cookie', sessionCookie).expect(200);
        const orgId = me.body.organizations[0].id as string;
        await request(app.getHttpServer())
          .post(`/orgs/${orgId}/drafts/claim`)
          .set('Cookie', [...sessionCookie, draftCookie])
          .expect(201);

        await request(app.getHttpServer()).get(`/preview/${slug}`).expect(404);
      });

      it('404s once the link has expired', async () => {
        mockSite();
        const draftRes = await request(app.getHttpServer())
          .post('/drafts')
          .send({ url: 'https://preview-itest.example/' })
          .expect(201);
        const draftCookie = draftCookieFrom(draftRes);

        const linkRes = await request(app.getHttpServer())
          .post('/drafts/me/preview-link')
          .set('Cookie', draftCookie)
          .expect(201);
        const slug = slugFromUrl(linkRes.body.url as string);
        await request(app.getHttpServer()).get(`/preview/${slug}`).expect(200);

        // Backdates the link's own expiry directly — the draft's own 7-day TTL is too
        // far out to wait for in a test; this isolates exactly the behavior under test
        // (preview_links_slug_lookup's own expiry check), not the draft's. Needs the
        // draft's own token context (preview_links_draft_access, 0014) — a bare
        // migrator.db call with no context set would affect 0 rows under FORCE RLS.
        const { createHash } = await import('node:crypto');
        const slugHash = createHash('sha256').update(slug).digest('hex');
        const rawDraftToken = draftCookie.split('=')[1]!;
        const draftTokenHash = createHash('sha256').update(rawDraftToken).digest('hex');
        await runInTokenLookupContext(migrator.db, draftTokenHash, () =>
          getTenantDb()
            .update(schema.previewLinks)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(schema.previewLinks.slugHash, slugHash)),
        );

        await request(app.getHttpServer()).get(`/preview/${slug}`).expect(404);
      });
    });
  },
);
