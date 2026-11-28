import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createDb } from '../src/client';
import { runInTenantContext, runInWorkerBuildContext, getTenantDb } from '../src/tenant-context';
import { organizations, memberships, users, projects, builds, provisioningProfiles } from '../src/schema';

// See packages/db/test/tenant-context.integration.test.ts for why this skips locally
// but hard-fails in CI when REQUIRE_LIVE_SERVICES=true.
const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);
if (!hasLiveDb && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL are not set');
}

describe.skipIf(!hasLiveDb)('provisioning_profiles RLS (live Postgres)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);

  const userId = `provisioning-profiles-rls-test-${uuidv7()}`;
  const orgAId = uuidv7();
  const orgBId = uuidv7();
  let projectAId: string;

  beforeAll(async () => {
    await migrator.db.insert(users).values({ id: userId, name: 'Provisioning Profiles RLS Test', email: `${userId}@example.com` });

    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(organizations).values({ id: orgAId, name: 'Org A', slug: `org-a-${orgAId}` });
      await tx.insert(memberships).values({ userId, orgId: orgAId, role: 'owner' });
      projectAId = uuidv7();
      await tx.insert(projects).values({
        id: projectAId,
        orgId: orgAId,
        name: 'Project A',
        sourceUrl: 'https://a.example/',
        config: { id: projectAId, name: 'Project A' },
      });
    });

    await runInTenantContext(migrator.db, { orgId: orgBId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(organizations).values({ id: orgBId, name: 'Org B', slug: `org-b-${orgBId}` });
      await tx.insert(memberships).values({ userId, orgId: orgBId, role: 'owner' });
    });
  });

  beforeEach(async () => {
    // One cached profile per project (the unique index), so a leftover row from a
    // previous test would trip it in the next one.
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () => getTenantDb().delete(provisioningProfiles));
  });

  afterAll(async () => {
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
      await getTenantDb().delete(builds);
      await getTenantDb().delete(projects);
      await getTenantDb().delete(memberships);
    });
    await runInTenantContext(migrator.db, { orgId: orgBId, userId }, () => getTenantDb().delete(memberships));
    await migrator.db.delete(organizations);
    await migrator.db.delete(users);
    await migrator.pool.end();
    await app.pool.end();
  });

  async function insertProfile(overrides: Partial<typeof provisioningProfiles.$inferInsert> = {}): Promise<string> {
    const id = uuidv7();
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
      getTenantDb()
        .insert(provisioningProfiles)
        .values({
          id,
          orgId: orgAId,
          projectId: projectAId,
          bundleId: 'am.mobilio.t.cafe',
          devicesHash: 'hash-1',
          profileId: 'apple-profile-1',
          profileContentEnc: 'ciphertext-placeholder',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          ...overrides,
        }),
    );
    return id;
  }

  it("org A's own tenant context sees its cached profile", async () => {
    await insertProfile();
    const seen = await runInTenantContext(app.db, { orgId: orgAId, userId }, () => getTenantDb().select().from(provisioningProfiles));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.bundleId).toBe('am.mobilio.t.cafe');
  });

  it("org B's tenant context cannot see org A's cached profile", async () => {
    await insertProfile();
    const seen = await runInTenantContext(app.db, { orgId: orgBId, userId }, () => getTenantDb().select().from(provisioningProfiles));
    expect(seen).toHaveLength(0);
  });

  it('a direct query outside any context sees zero rows (fail closed)', async () => {
    await insertProfile();
    const seen = await app.db.select().from(provisioningProfiles);
    expect(seen).toHaveLength(0);
  });

  it("runInWorkerBuildContext can read/write the project's cached profile, scoped by the build it looked up", async () => {
    await insertProfile();
    const buildId = uuidv7();
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
      getTenantDb().insert(builds).values({ id: buildId, orgId: orgAId, projectId: projectAId, status: 'queued' }),
    );

    const seen = await runInWorkerBuildContext(app.db, buildId, () => getTenantDb().select().from(provisioningProfiles));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.projectId).toBe(projectAId);

    const updated = await runInWorkerBuildContext(app.db, buildId, () =>
      getTenantDb()
        .update(provisioningProfiles)
        .set({ profileId: 'apple-profile-2' })
        .where(eq(provisioningProfiles.projectId, projectAId))
        .returning(),
    );
    expect(updated).toHaveLength(1);
    expect(updated![0]!.profileId).toBe('apple-profile-2');
  });

  it("runInWorkerBuildContext does NOT see a different project's cached profile, even in the same org", async () => {
    await insertProfile();
    const otherProjectId = uuidv7();
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
      getTenantDb().insert(projects).values({
        id: otherProjectId,
        orgId: orgAId,
        name: 'Project A2',
        sourceUrl: 'https://a2.example/',
        config: { id: otherProjectId, name: 'Project A2' },
      }),
    );
    const buildId = uuidv7();
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
      getTenantDb().insert(builds).values({ id: buildId, orgId: orgAId, projectId: otherProjectId, status: 'queued' }),
    );

    const seen = await runInWorkerBuildContext(app.db, buildId, () => getTenantDb().select().from(provisioningProfiles));
    expect(seen).toHaveLength(0);

    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
      getTenantDb().delete(projects).where(eq(projects.id, otherProjectId)),
    );
  });

  it('the unique index rejects a second cached profile for the same project+bundle id', async () => {
    await insertProfile();
    let caught: unknown;
    try {
      await insertProfile();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { cause?: Error }).cause?.message).toMatch(/provisioning_profiles_project_bundle_unique/i);
  });
});
