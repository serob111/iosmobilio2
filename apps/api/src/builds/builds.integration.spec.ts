import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server.js';
import { createApp } from '../create-app.js';
import { FakeRunner } from './fake-runner.js';

// Same fake-DNS approach as projects.integration.spec.ts/drafts.integration.spec.ts —
// only this one host is faked, everything else (Postgres/Redis/MinIO on localhost)
// resolves for real. A project needs a real-looking site to analyze before a build can
// be created against it.
const FAKE_SITE_HOST = 'builds-itest.example';
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

const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe.skipIf(!hasLiveServices)(
  'builds: create/dispatch via FakeRunner + the full runner-token callback flow (live Postgres + Redis + MinIO)',
  () => {
    let app: INestApplication;
    let mailLogFile: string;
    let fakeRunner: FakeRunner;

    beforeAll(async () => {
      mailLogFile = join(tmpdir(), `mobilio-mail-log-builds-${Date.now()}.ndjson`);
      process.env.MAIL_LOG_FILE = mailLogFile;
      // Read once by BuildsModule's BUILD_RUNNER factory at provider instantiation
      // (app.init() time), so it must be set before createApp() is called.
      process.env.BUILD_RUNNER = 'fake';

      app = await createApp();
      await app.init();
      fakeRunner = app.get(FakeRunner);

      server.listen({ onUnhandledFrame: 'bypass' });
    });

    afterAll(async () => {
      server.close();
      await app.close();
      if (existsSync(mailLogFile)) {
        unlinkSync(mailLogFile);
      }
      delete process.env.MAIL_LOG_FILE;
      delete process.env.BUILD_RUNNER;
    });

    afterEach(() => server.resetHandlers());

    function mockSite(): void {
      server.use(
        http.get('https://builds-itest.example/', () =>
          HttpResponse.text(
            `<html><head><title>Build Test Cafe</title><meta name="theme-color" content="#336699"></head>
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

    /** Signs in, creates an org (via sign-in) and a project in it, returns both ids plus the session cookie. */
    async function setupOrgAndProject(email: string): Promise<{ cookie: string[]; orgId: string; projectId: string }> {
      mockSite();
      const cookie = await signInByMagicLink(email);
      const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
      const orgId = me.body.organizations[0].id as string;

      const createRes = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/projects`)
        .set('Cookie', cookie)
        .send({ url: 'https://builds-itest.example/' })
        .expect(201);
      return { cookie, orgId, projectId: createRes.body.id as string };
    }

    /** Creates a build via the user-facing endpoint and reads the raw token FakeRunner recorded for it back out. */
    async function createBuildAndGetToken(
      cookie: string[],
      orgId: string,
      projectId: string,
    ): Promise<{ buildId: string; rawToken: string }> {
      const res = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/projects/${projectId}/builds`)
        .set('Cookie', cookie)
        .expect(201);
      const buildId = res.body.id as string;
      expect(res.body.status).toBe('queued');

      const dispatched = fakeRunner.dispatched.find((d) => d.id === buildId);
      if (!dispatched) throw new Error(`FakeRunner never recorded a dispatch for build ${buildId}`);
      return { buildId, rawToken: dispatched.token };
    }

    function bearer(rawToken: string): [string, string] {
      return ['Authorization', `Bearer ${rawToken}`];
    }

    it(
      'runs a build through the full runner callback flow: 409 while active, start -> config -> icon -> upload -> done, ' +
        'then the token stops working and the signed .ipa url serves the same bytes',
      async () => {
        const { cookie, orgId, projectId } = await setupOrgAndProject(`itest-builds-happy-${Date.now()}@example.com`);

        const { buildId, rawToken } = await createBuildAndGetToken(cookie, orgId, projectId);

        const conflict = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/builds`)
          .set('Cookie', cookie);
        expect(conflict.status).toBe(409);
        expect(conflict.body.error.code).toBe('BUILD_IN_PROGRESS');

        const startRes = await request(app.getHttpServer())
          .post(`/builds/${buildId}/start`)
          .set(...bearer(rawToken))
          .send({ runId: 123, runUrl: 'https://github.com/example/example/actions/runs/123' })
          .expect(201);
        expect(startRes.body.status).toBe('building');

        // Idempotent: a repeat call (e.g. a retried webhook) while already building succeeds again.
        await request(app.getHttpServer())
          .post(`/builds/${buildId}/start`)
          .set(...bearer(rawToken))
          .send({ runId: 123, runUrl: 'https://github.com/example/example/actions/runs/123' })
          .expect(201);

        const configRes = await request(app.getHttpServer())
          .get(`/builds/${buildId}/config`)
          .set(...bearer(rawToken))
          .expect(200);
        expect(configRes.body.config.name).toBe('Build Test Cafe');
        expect(configRes.body.templateVersion).toBeTruthy();

        const iconRes = await request(app.getHttpServer())
          .get(`/builds/${buildId}/icon`)
          .set(...bearer(rawToken));
        expect(iconRes.status).toBe(200);
        expect(iconRes.headers['content-type']).toBe('image/png');
        expect((iconRes.body as Buffer).length).toBeGreaterThan(0);

        const zip = Buffer.concat([ZIP_HEADER, Buffer.from('fake ipa contents for the e2e test')]);
        const uploadRes = await request(app.getHttpServer())
          .post(`/builds/${buildId}/ipa`)
          .set(...bearer(rawToken))
          .set('Content-Type', 'application/octet-stream')
          .send(zip);
        expect(uploadRes.status).toBe(201);

        const getBuildRes = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/builds/${buildId}`)
          .set('Cookie', cookie)
          .expect(200);
        expect(getBuildRes.body.status).toBe('done');

        // The token is cleared on the done transition — the exact same bearer token
        // no longer resolves to anything, not even a stale-state error.
        const deadTokenRes = await request(app.getHttpServer()).post(`/builds/${buildId}/start`).set(...bearer(rawToken)).send({ runId: 1, runUrl: 'x' });
        expect(deadTokenRes.status).toBe(404);
        expect(deadTokenRes.body.error.code).toBe('BUILD_NOT_FOUND');

        const ipaRedirect = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/builds/${buildId}/ipa`)
          .set('Cookie', cookie)
          .redirects(0);
        expect(ipaRedirect.status).toBe(302);
        const fetched = await fetch(ipaRedirect.headers.location as string);
        expect(fetched.status).toBe(200);
        const bytes = Buffer.from(await fetched.arrayBuffer());
        expect(bytes.equals(zip)).toBe(true);

        // The active-build slot is free again now that this one is done.
        const secondBuild = await request(app.getHttpServer())
          .post(`/orgs/${orgId}/projects/${projectId}/builds`)
          .set('Cookie', cookie);
        expect(secondBuild.status).toBe(201);
      },
    );

    it('fails a build via the runner callback: token is cleared and stops working afterward', async () => {
      const { cookie, orgId, projectId } = await setupOrgAndProject(`itest-builds-fail-${Date.now()}@example.com`);
      const { buildId, rawToken } = await createBuildAndGetToken(cookie, orgId, projectId);

      await request(app.getHttpServer())
        .post(`/builds/${buildId}/start`)
        .set(...bearer(rawToken))
        .send({ runId: 1, runUrl: 'https://example.com/run/1' })
        .expect(201);

      const failRes = await request(app.getHttpServer())
        .post(`/builds/${buildId}/fail`)
        .set(...bearer(rawToken))
        .send({ error: 'xcodebuild exited with status 65' });
      expect(failRes.status).toBe(201);

      const getBuildRes = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/projects/${projectId}/builds/${buildId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(getBuildRes.body.status).toBe('failed');
      expect(getBuildRes.body.error).toBe('xcodebuild exited with status 65');

      const deadTokenRes = await request(app.getHttpServer())
        .post(`/builds/${buildId}/fail`)
        .set(...bearer(rawToken))
        .send({ error: 'retry' });
      expect(deadTokenRes.status).toBe(404);
    });

    it('rejects an .ipa upload attempted before start (still queued) with 409 INVALID_BUILD_STATE', async () => {
      const { cookie, orgId, projectId } = await setupOrgAndProject(`itest-builds-invalid-transition-${Date.now()}@example.com`);
      const { buildId, rawToken } = await createBuildAndGetToken(cookie, orgId, projectId);

      const res = await request(app.getHttpServer())
        .post(`/builds/${buildId}/ipa`)
        .set(...bearer(rawToken))
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.concat([ZIP_HEADER, Buffer.from('should never be stored')]));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_BUILD_STATE');
    });

    it(
      'rejects an .ipa upload over the 300MB cap with 413 FILE_TOO_LARGE, enforced while streaming (not after full buffering)',
      async () => {
        const { cookie, orgId, projectId } = await setupOrgAndProject(`itest-builds-toolarge-${Date.now()}@example.com`);
        const { buildId, rawToken } = await createBuildAndGetToken(cookie, orgId, projectId);

        await request(app.getHttpServer())
          .post(`/builds/${buildId}/start`)
          .set(...bearer(rawToken))
          .send({ runId: 1, runUrl: 'https://example.com/run/1' })
          .expect(201);

        const oversized = Buffer.alloc(300 * 1024 * 1024 + 1, 1);
        oversized.set(ZIP_HEADER, 0);

        const res = await request(app.getHttpServer())
          .post(`/builds/${buildId}/ipa`)
          .set(...bearer(rawToken))
          .set('Content-Type', 'application/octet-stream')
          .send(oversized);

        expect(res.status).toBe(413);
        expect(res.body.error.code).toBe('FILE_TOO_LARGE');

        // The failed upload didn't leave the build stuck "building" forever from the
        // runner's point of view, nor silently marked done.
        const getBuildRes = await request(app.getHttpServer())
          .get(`/orgs/${orgId}/projects/${projectId}/builds/${buildId}`)
          .set('Cookie', cookie)
          .expect(200);
        expect(getBuildRes.body.status).toBe('building');
      },
      90000,
    );

    it('404s the same for a wrong/unknown build token (no signal that leaks whether a build exists)', async () => {
      const res = await request(app.getHttpServer())
        .get('/builds/00000000-0000-7000-8000-000000000000/config')
        .set(...bearer('a'.repeat(64)));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BUILD_NOT_FOUND');
    });
  },
);
