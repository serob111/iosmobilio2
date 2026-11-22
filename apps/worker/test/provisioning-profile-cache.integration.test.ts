import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createDb, runInTenantContext, runInWorkerBuildContext, getTenantDb, schema, eq } from '@mobilio/db';
import { DrizzleProvisioningProfileCache } from '../src/provisioning-profile-cache';

// Same REQUIRE_LIVE_SERVICES convention as test/drafts-cleanup.integration.test.ts.
const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);
if (!hasLiveDb && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL are not set');
}

describe.skipIf(!hasLiveDb)('DrizzleProvisioningProfileCache (live Postgres)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);
  process.env.PROVISIONING_PROFILE_KEY ??= randomBytes(32).toString('base64');

  const userId = `prov-cache-itest-${uuidv7()}`;
  const orgId = uuidv7();
  let projectId: string;
  let buildId: string;

  beforeAll(async () => {
    await migrator.db.insert(schema.users).values({ id: userId, name: 'Provisioning Cache Test', email: `${userId}@example.com` });
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
        config: { id: projectId, name: 'Project' },
      });
      buildId = uuidv7();
      await tx.insert(schema.builds).values({ id: buildId, orgId, projectId, status: 'queued' });
    });
  });

  afterAll(async () => {
    await runInTenantContext(migrator.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      await tx.delete(schema.provisioningProfiles);
      await tx.delete(schema.builds);
      await tx.delete(schema.projects);
      await tx.delete(schema.memberships);
    });
    await migrator.db.delete(schema.organizations);
    await migrator.db.delete(schema.users);
    await migrator.pool.end();
    await app.pool.end();
  });

  it('find() returns undefined when nothing is cached yet', async () => {
    const result = await runInWorkerBuildContext(app.db, buildId, async () => {
      const cache = new DrizzleProvisioningProfileCache(orgId, projectId);
      return cache.find('am.mobilio.t.cafe');
    });
    expect(result).toBeUndefined();
  });

  it('save() then find() round-trips the profile content through real AES-256-GCM encryption', async () => {
    const profileContent = Buffer.from([0x30, 0x82, 0x01, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await runInWorkerBuildContext(app.db, buildId, async () => {
      const cache = new DrizzleProvisioningProfileCache(orgId, projectId);
      await cache.save('am.mobilio.t.cafe', { profileId: 'apple-profile-1', profileContent, devicesHash: 'hash-a', expiresAt });
    });

    // Confirm the stored column is genuinely ciphertext, not the raw bytes, by reading
    // it directly as the migrator — a real encryption check, not just a round-trip via
    // the same class that wrote it.
    const [row] = await runInTenantContext(migrator.db, { orgId, userId }, () =>
      getTenantDb().select().from(schema.provisioningProfiles),
    );
    expect(Buffer.from(row!.profileContentEnc, 'base64').includes(profileContent)).toBe(false);

    const found = await runInWorkerBuildContext(app.db, buildId, async () => {
      const cache = new DrizzleProvisioningProfileCache(orgId, projectId);
      return cache.find('am.mobilio.t.cafe');
    });
    expect(found?.profileId).toBe('apple-profile-1');
    expect(found?.devicesHash).toBe('hash-a');
    expect(found?.profileContent.equals(profileContent)).toBe(true);
    expect(found?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('save() on an existing bundleId upserts in place (ensureAdHocProfile replaces, never duplicates)', async () => {
    const firstContent = Buffer.from('first profile');
    const secondContent = Buffer.from('second profile');

    await runInWorkerBuildContext(app.db, buildId, async () => {
      const cache = new DrizzleProvisioningProfileCache(orgId, projectId);
      await cache.save('am.mobilio.t.upsert', {
        profileId: 'profile-v1',
        profileContent: firstContent,
        devicesHash: 'hash-1',
        expiresAt: new Date(Date.now() + 1000),
      });
      await cache.save('am.mobilio.t.upsert', {
        profileId: 'profile-v2',
        profileContent: secondContent,
        devicesHash: 'hash-2',
        expiresAt: new Date(Date.now() + 2000),
      });
    });

    const rows = await runInTenantContext(migrator.db, { orgId, userId }, () =>
      getTenantDb()
        .select()
        .from(schema.provisioningProfiles)
        .where(eq(schema.provisioningProfiles.bundleId, 'am.mobilio.t.upsert')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.profileId).toBe('profile-v2');

    const found = await runInWorkerBuildContext(app.db, buildId, async () => {
      const cache = new DrizzleProvisioningProfileCache(orgId, projectId);
      return cache.find('am.mobilio.t.upsert');
    });
    expect(found?.profileContent.equals(secondContent)).toBe(true);
  });
});
