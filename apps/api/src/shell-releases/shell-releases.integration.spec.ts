import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { schema, like } from '@mobilio/db';
import { createApp } from '../create-app.js';
import { DbService } from '../db/db.service.js';

const hasLiveServices =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_BUCKET) &&
  Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not all set');
}

const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const SECRET = 'a-long-enough-test-only-shell-release-secret';
const TEST_VERSION_PREFIX = `itest-${Date.now()}`;

function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

describe.skipIf(!hasLiveServices)('shell-releases: upload/register/activate (live Postgres + MinIO)', () => {
  let app: INestApplication;
  let dbService: DbService;

  beforeAll(async () => {
    process.env.SHELL_RELEASE_SECRET = SECRET;
    process.env.BUILD_RUNNER = 'fake';
    app = await createApp();
    await app.init();
    dbService = app.get(DbService);
  });

  afterAll(async () => {
    await dbService.db.delete(schema.shellReleases).where(like(schema.shellReleases.version, `${TEST_VERSION_PREFIX}%`));
    await app.close();
    delete process.env.SHELL_RELEASE_SECRET;
    delete process.env.BUILD_RUNNER;
  });

  it('rejects every request without the right bearer secret', async () => {
    await request(app.getHttpServer()).get('/internal/shell-releases').expect(401);
    await request(app.getHttpServer()).get('/internal/shell-releases').set(...bearer('wrong')).expect(401);
  });

  it('uploads an .ipa, registers it inactive, activates it, and lists it as the active release', async () => {
    const version = `${TEST_VERSION_PREFIX}-v1`;

    await request(app.getHttpServer())
      .post(`/internal/shell-releases/${version}/ipa`)
      .set(...bearer(SECRET))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.concat([ZIP_HEADER, Buffer.from('fake base ipa contents')]))
      .expect(201, { ok: true });

    const registerRes = await request(app.getHttpServer())
      .post('/internal/shell-releases')
      .set(...bearer(SECRET))
      .send({ version, sha256: 'a'.repeat(64), manifest: { shellVersion: version, gitSha: 'deadbeef' } })
      .expect(201);
    expect(registerRes.body).toMatchObject({ version, sha256: 'a'.repeat(64), isActive: false });

    const activeBeforeRes = await request(app.getHttpServer())
      .get('/internal/shell-releases/active')
      .set(...bearer(SECRET))
      .expect(200);
    expect(activeBeforeRes.body).toEqual({ active: null });

    const activateRes = await request(app.getHttpServer())
      .post(`/internal/shell-releases/${version}/activate`)
      .set(...bearer(SECRET))
      .expect(201);
    expect(activateRes.body).toMatchObject({ version, isActive: true });

    const activeAfterRes = await request(app.getHttpServer())
      .get('/internal/shell-releases/active')
      .set(...bearer(SECRET))
      .expect(200);
    expect(activeAfterRes.body).toMatchObject({ version, isActive: true });
  });

  it('activating a second release deactivates the first — only one is ever active at a time', async () => {
    const versionA = `${TEST_VERSION_PREFIX}-v2a`;
    const versionB = `${TEST_VERSION_PREFIX}-v2b`;

    for (const version of [versionA, versionB]) {
      await request(app.getHttpServer())
        .post(`/internal/shell-releases/${version}/ipa`)
        .set(...bearer(SECRET))
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.concat([ZIP_HEADER, Buffer.from('fake')]))
        .expect(201);
      await request(app.getHttpServer())
        .post('/internal/shell-releases')
        .set(...bearer(SECRET))
        .send({ version, sha256: 'b'.repeat(64), manifest: {} })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/internal/shell-releases/${versionA}/activate`)
      .set(...bearer(SECRET))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/internal/shell-releases/${versionB}/activate`)
      .set(...bearer(SECRET))
      .expect(201);

    const activeRes = await request(app.getHttpServer())
      .get('/internal/shell-releases/active')
      .set(...bearer(SECRET))
      .expect(200);
    expect(activeRes.body.version).toBe(versionB);

    const listRes = await request(app.getHttpServer())
      .get('/internal/shell-releases')
      .set(...bearer(SECRET))
      .expect(200);
    const rowA = listRes.body.find((r: { version: string }) => r.version === versionA);
    expect(rowA.isActive).toBe(false);
  });

  it('re-registering the same version upserts rather than creating a duplicate row', async () => {
    const version = `${TEST_VERSION_PREFIX}-v3`;
    await request(app.getHttpServer())
      .post('/internal/shell-releases')
      .set(...bearer(SECRET))
      .send({ version, sha256: 'c'.repeat(64), manifest: { attempt: 1 } })
      .expect(201);
    await request(app.getHttpServer())
      .post('/internal/shell-releases')
      .set(...bearer(SECRET))
      .send({ version, sha256: 'd'.repeat(64), manifest: { attempt: 2 } })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/internal/shell-releases')
      .set(...bearer(SECRET))
      .expect(200);
    const matching = listRes.body.filter((r: { version: string }) => r.version === version);
    expect(matching).toHaveLength(1);
    expect(matching[0].sha256).toBe('d'.repeat(64));
  });

  it('404s activating a version that was never registered', async () => {
    await request(app.getHttpServer())
      .post(`/internal/shell-releases/${TEST_VERSION_PREFIX}-never-registered/activate`)
      .set(...bearer(SECRET))
      .expect(404)
      .expect((res) => {
        if (res.body.error?.code !== 'SHELL_RELEASE_NOT_FOUND') {
          throw new Error(`expected SHELL_RELEASE_NOT_FOUND, got ${JSON.stringify(res.body)}`);
        }
      });
  });

  it('rejects an .ipa upload that is not actually a zip', async () => {
    await request(app.getHttpServer())
      .post(`/internal/shell-releases/${TEST_VERSION_PREFIX}-bad-ipa/ipa`)
      .set(...bearer(SECRET))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('not a zip file at all'))
      .expect(400)
      .expect((res) => {
        if (res.body.error?.code !== 'INVALID_IPA') {
          throw new Error(`expected INVALID_IPA, got ${JSON.stringify(res.body)}`);
        }
      });
  });
});
