import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { schema, like } from '@mobilio/db';
import { createObjectStorageFromEnv, shellReleaseIpaKey } from '@mobilio/storage';
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

function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function fakeIpa(content: string): Buffer {
  return Buffer.concat([ZIP_HEADER, Buffer.from(content)]);
}

describe.skipIf(!hasLiveServices)('shell-releases: upload/register/activate (live Postgres + MinIO)', () => {
  let app: INestApplication;
  let dbService: DbService;
  const storage = hasLiveServices ? createObjectStorageFromEnv() : null!;

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

  /** uploadIpa + register for a brand-new version, asserting both succeed — the common setup every other test builds on. */
  async function uploadAndRegister(version: string, content: string, manifest: Record<string, unknown> = {}) {
    const ipa = fakeIpa(content);
    const sha256 = sha256Of(ipa);
    const uploadRes = await request(app.getHttpServer())
      .post(`/internal/shell-releases/${version}/ipa`)
      .set(...bearer(SECRET))
      .set('Content-Type', 'application/octet-stream')
      .send(ipa)
      .expect(201);
    expect(uploadRes.body.ok).toBe(true);
    const uploadId = uploadRes.body.uploadId as string;

    const registerRes = await request(app.getHttpServer())
      .post('/internal/shell-releases')
      .set(...bearer(SECRET))
      .send({ version, sha256, manifest, uploadId })
      .expect(201);
    return { sha256, uploadId, registerRes };
  }

  it('rejects every request without the right bearer secret', async () => {
    await request(app.getHttpServer()).get('/internal/shell-releases').expect(401);
    await request(app.getHttpServer()).get('/internal/shell-releases').set(...bearer('wrong')).expect(401);
  });

  it('uploads an .ipa, registers it inactive, activates it, and lists it as the active release', async () => {
    const version = `${TEST_VERSION_PREFIX}-v1`;
    const { sha256, registerRes } = await uploadAndRegister(version, 'fake base ipa contents', {
      shellVersion: version,
      gitSha: 'deadbeef',
    });
    expect(registerRes.body).toMatchObject({ version, sha256, isActive: false });

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
    await uploadAndRegister(versionA, 'fake-a');
    await uploadAndRegister(versionB, 'fake-b');

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

  it('re-registering the same version with the same sha256 returns the existing row unchanged (200, idempotent retry)', async () => {
    const version = `${TEST_VERSION_PREFIX}-v3-same`;
    const { sha256, registerRes: first } = await uploadAndRegister(version, 'same-content', { attempt: 1 });

    // A second, independent upload+register pass for the same version and the same
    // underlying bytes — e.g. a workflow re-run after its own transient failure.
    const ipa = fakeIpa('same-content');
    const uploadRes = await request(app.getHttpServer())
      .post(`/internal/shell-releases/${version}/ipa`)
      .set(...bearer(SECRET))
      .set('Content-Type', 'application/octet-stream')
      .send(ipa)
      .expect(409); // already registered — uploadIpa never re-checks sha256, it just refuses
    expect(uploadRes.body.error.code).toBe('SHELL_RELEASE_IMMUTABLE');

    // register() itself is still independently idempotent given the *original* uploadId —
    // calling it again with the same version+sha256 must return 200, not fail or duplicate.
    const secondRegisterRes = await request(app.getHttpServer())
      .post('/internal/shell-releases')
      .set(...bearer(SECRET))
      .send({ version, sha256, manifest: { attempt: 1 } })
      .expect(200);
    expect(secondRegisterRes.body).toEqual(first.body);

    const listRes = await request(app.getHttpServer())
      .get('/internal/shell-releases')
      .set(...bearer(SECRET))
      .expect(200);
    expect(listRes.body.filter((r: { version: string }) => r.version === version)).toHaveLength(1);
  });

  it('re-registering the same version with a different sha256 is rejected (409), without changing the existing row', async () => {
    const version = `${TEST_VERSION_PREFIX}-v3-diff`;
    const { sha256 } = await uploadAndRegister(version, 'original-content');

    const res = await request(app.getHttpServer())
      .post('/internal/shell-releases')
      .set(...bearer(SECRET))
      .send({ version, sha256: 'f'.repeat(64), manifest: { attempt: 2 } })
      .expect(409);
    expect(res.body.error.code).toBe('SHELL_RELEASE_IMMUTABLE');

    const listRes = await request(app.getHttpServer())
      .get('/internal/shell-releases')
      .set(...bearer(SECRET))
      .expect(200);
    const row = listRes.body.find((r: { version: string }) => r.version === version);
    expect(row.sha256).toBe(sha256);
  });

  it('uploading for an already-registered (including active) version is rejected, and the registered .ipa is untouched', async () => {
    const version = `${TEST_VERSION_PREFIX}-v4-active`;
    await uploadAndRegister(version, 'active-release-content');
    await request(app.getHttpServer())
      .post(`/internal/shell-releases/${version}/activate`)
      .set(...bearer(SECRET))
      .expect(201);

    const before = await storage.get(shellReleaseIpaKey(version));

    const res = await request(app.getHttpServer())
      .post(`/internal/shell-releases/${version}/ipa`)
      .set(...bearer(SECRET))
      .set('Content-Type', 'application/octet-stream')
      .send(fakeIpa('a-completely-different-payload'))
      .expect(409);
    expect(res.body.error.code).toBe('SHELL_RELEASE_IMMUTABLE');

    const after = await storage.get(shellReleaseIpaKey(version));
    expect(after.equals(before)).toBe(true);
  });

  it('rejects register() when the claimed sha256 does not match what was actually uploaded (400 SHA256_MISMATCH)', async () => {
    const version = `${TEST_VERSION_PREFIX}-v5-mismatch`;
    const uploadRes = await request(app.getHttpServer())
      .post(`/internal/shell-releases/${version}/ipa`)
      .set(...bearer(SECRET))
      .set('Content-Type', 'application/octet-stream')
      .send(fakeIpa('real content'))
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/internal/shell-releases')
      .set(...bearer(SECRET))
      .send({ version, sha256: 'e'.repeat(64), manifest: {}, uploadId: uploadRes.body.uploadId })
      .expect(400);
    expect(res.body.error.code).toBe('SHA256_MISMATCH');

    const listRes = await request(app.getHttpServer())
      .get('/internal/shell-releases')
      .set(...bearer(SECRET))
      .expect(200);
    expect(listRes.body.find((r: { version: string }) => r.version === version)).toBeUndefined();
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
