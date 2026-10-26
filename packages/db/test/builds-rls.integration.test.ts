import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createDb } from '../src/client';
import { runInTenantContext, runInBuildContext, getTenantDb } from '../src/tenant-context';
import { organizations, memberships, users, projects, builds } from '../src/schema';

// See packages/db/test/tenant-context.integration.test.ts for why this skips locally
// but hard-fails in CI when REQUIRE_LIVE_SERVICES=true.
const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);
if (!hasLiveDb && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL are not set');
}

describe.skipIf(!hasLiveDb)('builds RLS (live Postgres)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);

  const userId = `builds-rls-test-${uuidv7()}`;
  const orgAId = uuidv7();
  const orgBId = uuidv7();
  let projectAId: string;

  beforeAll(async () => {
    await migrator.db.insert(users).values({ id: userId, name: 'Builds RLS Test', email: `${userId}@example.com` });

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
    // Every test in this file inserts a 'queued' build for the same projectAId — the
    // partial unique index (one active build per project) means a leftover row from a
    // previous test would spuriously trip it in the next one.
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () => getTenantDb().delete(builds));
  });

  afterAll(async () => {
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
      await getTenantDb().delete(projects);
      await getTenantDb().delete(memberships);
    });
    await runInTenantContext(migrator.db, { orgId: orgBId, userId }, async () => {
      await getTenantDb().delete(memberships);
    });
    await migrator.db.delete(organizations);
    await migrator.db.delete(users);
    await migrator.pool.end();
    await app.pool.end();
  });

  async function insertBuild(overrides: Partial<typeof builds.$inferInsert> = {}): Promise<string> {
    const id = uuidv7();
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
      getTenantDb()
        .insert(builds)
        .values({
          id,
          orgId: orgAId,
          projectId: projectAId,
          status: 'queued',
          tokenHash: `test-hash-${uuidv7()}`,
          tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          ...overrides,
        }),
    );
    return id;
  }

  it('runInBuildContext finds a live build by its token and can read its project under the same context (no app.user_id needed)', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    const buildId = await insertBuild({ tokenHash });

    const result = await runInBuildContext(app.db, tokenHash, async (build) => {
      expect(build.id).toBe(buildId);
      expect(build.orgId).toBe(orgAId);
      const [project] = await getTenantDb().select().from(projects).where(eq(projects.id, build.projectId));
      return project;
    });

    expect(result?.id).toBe(projectAId);
  });

  it('returns undefined for a token that matches nothing', async () => {
    const result = await runInBuildContext(app.db, `no-such-hash-${uuidv7()}`, async () => 'should not run');
    expect(result).toBeUndefined();
  });

  it('returns undefined for an expired token', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await insertBuild({ tokenHash, tokenExpiresAt: new Date(Date.now() - 30_000) });

    const result = await runInBuildContext(app.db, tokenHash, async () => 'should not run');
    expect(result).toBeUndefined();
  });

  it('returns undefined for the token of a build that already finished (done)', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await insertBuild({ tokenHash, status: 'done', finishedAt: new Date() });

    const result = await runInBuildContext(app.db, tokenHash, async () => 'should not run');
    expect(result).toBeUndefined();
  });

  it('returns undefined for the token of a build that already finished (failed)', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await insertBuild({ tokenHash, status: 'failed', error: 'boom', finishedAt: new Date() });

    const result = await runInBuildContext(app.db, tokenHash, async () => 'should not run');
    expect(result).toBeUndefined();
  });

  it('WITH CHECK (true) still lets a token-scoped UPDATE clear the token and move to a finished status', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    const buildId = await insertBuild({ tokenHash });

    const updated = await runInBuildContext(app.db, tokenHash, () =>
      getTenantDb()
        .update(builds)
        .set({ status: 'done', tokenHash: null, tokenExpiresAt: null, finishedAt: new Date() })
        .where(eq(builds.id, buildId))
        .returning(),
    );
    expect(updated).toHaveLength(1);

    // The same token can no longer find the (now finished, detokenized) build.
    const after = await runInBuildContext(app.db, tokenHash, async () => 'should not run');
    expect(after).toBeUndefined();
  });

  it("org B's tenant context cannot see org A's build", async () => {
    await insertBuild();
    const seenFromB = await runInTenantContext(app.db, { orgId: orgBId, userId }, () =>
      getTenantDb().select().from(builds),
    );
    expect(seenFromB).toHaveLength(0);
  });

  it('a direct query outside any context sees zero builds (fail closed)', async () => {
    await insertBuild();
    const seen = await app.db.select().from(builds);
    expect(seen).toHaveLength(0);
  });

  it('the partial unique index rejects a second queued/building build for the same project', async () => {
    await insertBuild();

    let caught: unknown;
    try {
      await insertBuild();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { cause?: Error }).cause?.message).toMatch(/builds_one_active_per_project/i);
  });
});
