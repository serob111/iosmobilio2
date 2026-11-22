import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createDb, runInTenantContext, getTenantDb, schema, eq } from '@mobilio/db';
import type { ObjectStorage } from '@mobilio/storage';

// Only runs when a real Postgres is reachable — see test/drafts-cleanup.integration.test.ts
// for the same REQUIRE_LIVE_SERVICES convention.
const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);
if (!hasLiveDb && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL are not set');
}

const mockEnsureBundleId = vi.hoisted(() => vi.fn());
const mockListRegisteredDeviceIds = vi.hoisted(() => vi.fn());
const mockEnsureAdHocProfile = vi.hoisted(() => vi.fn());
const mockWithP12FromBase64 = vi.hoisted(() => vi.fn());
const mockRepack = vi.hoisted(() => vi.fn());
const mockValidateProjectConfig = vi.hoisted(() => vi.fn());
const mockGetCachedBaseIpa = vi.hoisted(() => vi.fn());

vi.mock('@mobilio/apple', () => ({
  AppStoreConnectClient: vi.fn().mockImplementation(() => ({})),
  ensureBundleId: mockEnsureBundleId,
  listRegisteredDeviceIds: mockListRegisteredDeviceIds,
  ensureAdHocProfile: mockEnsureAdHocProfile,
  withP12FromBase64: mockWithP12FromBase64,
}));
vi.mock('@mobilio/repacker', () => ({
  repack: mockRepack,
  validateProjectConfig: mockValidateProjectConfig,
}));
vi.mock('../src/base-ipa-cache.js', () => ({ getCachedBaseIpa: mockGetCachedBaseIpa }));
vi.mock('../src/provisioning-profile-cache.js', () => ({
  DrizzleProvisioningProfileCache: vi.fn().mockImplementation(() => ({})),
}));

const { processRepackJob } = await import('../src/repack-job');

describe.skipIf(!hasLiveDb)('processRepackJob (live Postgres, mocked Apple/repacker)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);
  process.env.PROVISIONING_PROFILE_KEY ??= randomBytes(32).toString('base64');

  const userId = `repack-job-itest-${uuidv7()}`;
  const orgId = uuidv7();
  let projectId: string;

  const fakeAppleEnv = {
    ascCredentials: { issuerId: 'issuer', keyId: 'key', privateKeyPem: 'pem' },
    signingP12Base64: Buffer.from('p12').toString('base64'),
    signingP12Password: 'pw',
    distributionCertId: 'cert-1',
    teamId: 'TEAM123456',
  };
  const jobConfig = {
    cacheDir: '/tmp/repack-job-itest-cache',
    rcodesign: { binaryPath: '/usr/local/bin/rcodesign', expectedSha256: 'deadbeef' },
    appleEnv: fakeAppleEnv,
  };

  function fakeStorage(): ObjectStorage {
    return {
      put: vi.fn(),
      // Actually drains the stream (rather than just resolving immediately) so a real
      // file-read error on the path it's given surfaces as a proper rejection here,
      // not as an unhandled exception after the test has already moved on.
      putStream: vi.fn().mockImplementation(async (_key: string, body: Readable) => {
        for await (const chunk of body) void chunk; // drain
      }),
      get: vi.fn(),
      getStream: vi.fn().mockResolvedValue(Readable.from([Buffer.from('fake icon bytes')])),
      delete: vi.fn(),
      signedUrl: vi.fn(),
      copy: vi.fn(),
      list: vi.fn(),
    } as unknown as ObjectStorage;
  }

  beforeAll(async () => {
    await migrator.db.insert(schema.users).values({ id: userId, name: 'Repack Job Test', email: `${userId}@example.com` });
    await runInTenantContext(migrator.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(schema.organizations).values({ id: orgId, name: 'Org', slug: `org-${orgId}` });
      await tx.insert(schema.memberships).values({ userId, orgId, role: 'owner' });
      projectId = uuidv7();
      await tx.insert(schema.projects).values({
        id: projectId,
        orgId,
        name: 'Project',
        sourceUrl: 'https://p.example/',
        config: { id: projectId, name: 'Cafe Mobilio', bundleId: 'am.mobilio.t.cafe' },
      });
    });
    await runInTenantContext(migrator.db, { orgId, userId }, () =>
      getTenantDb().insert(schema.shellReleases).values({
        id: uuidv7(),
        version: '1.0.0',
        ipaKey: 'shell-base/1.0.0/base.ipa',
        manifest: {},
        sha256: 'a'.repeat(64),
        isActive: true,
      }),
    );
  });

  afterAll(async () => {
    await runInTenantContext(migrator.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      await tx.delete(schema.provisioningProfiles);
      await tx.delete(schema.builds);
      await tx.delete(schema.projects);
      await tx.delete(schema.memberships);
    });
    await migrator.db.delete(schema.shellReleases);
    await migrator.db.delete(schema.organizations);
    await migrator.db.delete(schema.users);
    await migrator.pool.end();
    await app.pool.end();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateProjectConfig.mockImplementation((raw: unknown) => raw);
    mockEnsureBundleId.mockResolvedValue({ resourceId: 'bundle-resource-1', identifier: 'am.mobilio.t.cafe', created: false });
    mockListRegisteredDeviceIds.mockResolvedValue(['device-1', 'device-2']);
    mockEnsureAdHocProfile.mockResolvedValue({
      profileId: 'apple-profile-1',
      profileContent: Buffer.from('fake profile bytes'),
      devicesHash: 'hash',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    });
    mockWithP12FromBase64.mockImplementation(async (_base64: string, fn: (p12Path: string) => Promise<unknown>) => fn('/tmp/fake.p12'));
    const fakeOutputDir = mkdtempSync(join(tmpdir(), 'repack-job-itest-output-'));
    const fakeOutputIpaPath = join(fakeOutputDir, 'output.ipa');
    writeFileSync(fakeOutputIpaPath, 'fake signed ipa bytes');
    mockRepack.mockResolvedValue({ outputIpaPath: fakeOutputIpaPath, timings: [{ step: 'sign', durationMs: 42 }] });
    mockGetCachedBaseIpa.mockResolvedValue('/tmp/fake-base.ipa');
  });

  async function insertBuild(): Promise<string> {
    const id = uuidv7();
    await runInTenantContext(migrator.db, { orgId, userId }, () =>
      getTenantDb().insert(schema.builds).values({ id, orgId, projectId, status: 'queued' }),
    );
    return id;
  }

  afterEach(async () => {
    await runInTenantContext(migrator.db, { orgId, userId }, () => getTenantDb().delete(schema.builds));
  });

  it('marks the build done, records ipaKey/shortVersion/stepTimings, and calls every Apple/repacker step in order', async () => {
    const buildId = await insertBuild();
    const storage = fakeStorage();

    await processRepackJob(app.db, storage, buildId, jobConfig);

    const [build] = await runInTenantContext(migrator.db, { orgId, userId }, () =>
      getTenantDb().select().from(schema.builds).where(eq(schema.builds.id, buildId)),
    );
    expect(build!.status).toBe('done');
    expect(build!.shortVersion).toBe('1.0.0');
    expect(build!.ipaKey).toContain(buildId);
    expect(build!.finishedAt).not.toBeNull();
    const timingSteps = (build!.stepTimings as { step: string }[]).map((t) => t.step);
    expect(timingSteps).toEqual(
      expect.arrayContaining(['fetchActiveBase', 'downloadBase', 'downloadIcon', 'ensureBundleId', 'listDevices', 'ensureAdHocProfile', 'sign', 'uploadIpa']),
    );

    expect(mockEnsureBundleId).toHaveBeenCalledWith(expect.anything(), 'am.mobilio.t.cafe', 'Cafe Mobilio');
    expect(mockEnsureAdHocProfile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bundleIdResourceId: 'bundle-resource-1', certificateId: 'cert-1', deviceIds: ['device-1', 'device-2'] }),
    );
    expect(mockRepack).toHaveBeenCalledWith(
      expect.objectContaining({ bundleId: 'am.mobilio.t.cafe', displayName: 'Cafe Mobilio', teamId: 'TEAM123456' }),
    );
  });

  it('marks the build failed and records the error + partial timings when a step throws', async () => {
    const buildId = await insertBuild();
    const storage = fakeStorage();
    mockEnsureAdHocProfile.mockRejectedValue(new Error('Apple API unreachable'));

    await expect(processRepackJob(app.db, storage, buildId, jobConfig)).rejects.toThrow('Apple API unreachable');

    const [build] = await runInTenantContext(migrator.db, { orgId, userId }, () =>
      getTenantDb().select().from(schema.builds).where(eq(schema.builds.id, buildId)),
    );
    expect(build!.status).toBe('failed');
    expect(build!.error).toBe('Apple API unreachable');
    expect(build!.ipaKey).toBeNull();
    const timingSteps = (build!.stepTimings as { step: string }[]).map((t) => t.step);
    expect(timingSteps).toContain('ensureAdHocProfile');
    expect(timingSteps).not.toContain('uploadIpa');
    expect(mockRepack).not.toHaveBeenCalled();
  });

  it('never calls repack() when there is no active shell_releases version', async () => {
    const buildId = await insertBuild();
    const storage = fakeStorage();
    await migrator.db.update(schema.shellReleases).set({ isActive: false });

    await expect(processRepackJob(app.db, storage, buildId, jobConfig)).rejects.toThrow(/No active shell_releases/);
    expect(mockRepack).not.toHaveBeenCalled();

    await migrator.db.update(schema.shellReleases).set({ isActive: true });
  });
});
