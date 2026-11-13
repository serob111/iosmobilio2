import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createDb } from '../src/client';
import { runInTenantContext, runInBuildContext, getTenantDb } from '../src/tenant-context';
import { organizations, memberships, users, projects, builds } from '../src/schema';

const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);
if (!hasLiveDb && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL are not set');
}

type WatchdogRow = { id: string; orgId: string; projectId: string };

describe.skipIf(!hasLiveDb)('builds watchdog: public.fail_stuck_builds (live Postgres)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);

  const userId = `builds-watchdog-test-${uuidv7()}`;
  const orgId = uuidv7();
  let projectId: string;
  let project2Id: string;

  beforeAll(async () => {
    await migrator.db.insert(users).values({ id: userId, name: 'Builds Watchdog Test', email: `${userId}@example.com` });

    await runInTenantContext(migrator.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(organizations).values({ id: orgId, name: 'Watchdog Org', slug: `watchdog-org-${orgId}` });
      await tx.insert(memberships).values({ userId, orgId, role: 'owner' });
      projectId = uuidv7();
      await tx.insert(projects).values({
        id: projectId,
        orgId,
        name: 'Project',
        sourceUrl: 'https://watchdog.example/',
        config: { id: projectId, name: 'Project' },
      });
      project2Id = uuidv7();
      await tx.insert(projects).values({
        id: project2Id,
        orgId,
        name: 'Project 2',
        sourceUrl: 'https://watchdog2.example/',
        config: { id: project2Id, name: 'Project 2' },
      });
    });
  });

  beforeEach(async () => {
    // The partial unique index (one active build per project) means a leftover row from
    // a previous test would spuriously trip it in the next one.
    await runInTenantContext(migrator.db, { orgId, userId }, () => getTenantDb().delete(builds));
  });

  afterAll(async () => {
    await runInTenantContext(migrator.db, { orgId, userId }, async () => {
      await getTenantDb().delete(projects);
      await getTenantDb().delete(memberships);
    });
    await migrator.db.delete(organizations);
    await migrator.db.delete(users);
    await migrator.pool.end();
    await app.pool.end();
  });

  async function insertBuild(overrides: Partial<typeof builds.$inferInsert> & { projectId?: string } = {}): Promise<string> {
    const id = uuidv7();
    await runInTenantContext(migrator.db, { orgId, userId }, () =>
      getTenantDb()
        .insert(builds)
        .values({
          id,
          orgId,
          projectId: overrides.projectId ?? projectId,
          status: 'queued',
          ...overrides,
        }),
    );
    return id;
  }

  async function callWatchdog(db: ReturnType<typeof createDb>['db'], batch = 200): Promise<WatchdogRow[]> {
    const result = await db.execute<{ id: string; org_id: string; project_id: string }>(
      sql`select * from public.fail_stuck_builds(${batch})`,
    );
    return result.rows.map((row) => ({ id: row.id, orgId: row.org_id, projectId: row.project_id }));
  }

  it('fails a queued build stuck past 30 minutes (by created_at)', async () => {
    const tokenHash = `watchdog-hash-${uuidv7()}`;
    const buildId = await insertBuild({
      tokenHash,
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 31 * 60 * 1000),
    });

    const failed = await callWatchdog(app.db);
    expect(failed.map((r) => r.id)).toContain(buildId);

    const [row] = await migrator.db.select().from(builds).where(eq(builds.id, buildId));
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('timeout');
    expect(row?.tokenHash).toBeNull();
    expect(row?.tokenExpiresAt).toBeNull();
    expect(row?.finishedAt).not.toBeNull();
  });

  it('fails a building build stuck past 60 minutes (by started_at)', async () => {
    const tokenHash = `watchdog-hash-${uuidv7()}`;
    const buildId = await insertBuild({
      status: 'building',
      tokenHash,
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      startedAt: new Date(Date.now() - 61 * 60 * 1000),
    });

    const failed = await callWatchdog(app.db);
    expect(failed.map((r) => r.id)).toContain(buildId);

    const [row] = await migrator.db.select().from(builds).where(eq(builds.id, buildId));
    expect(row?.status).toBe('failed');
  });

  it('does not touch a fresh queued build, a fresh building build, or a done build', async () => {
    const freshQueuedId = await insertBuild({ createdAt: new Date() });
    const freshBuildingId = await insertBuild({
      status: 'building',
      projectId: project2Id,
      startedAt: new Date(),
    });
    // 'done' isn't covered by the partial unique index at all, so this can freely
    // reuse projectId even though freshQueuedId already occupies that project's one
    // active-build slot.
    const doneId = await insertBuild({ status: 'done', projectId });

    const failed = await callWatchdog(app.db);
    const failedIds = failed.map((r) => r.id);
    expect(failedIds).not.toContain(freshQueuedId);
    expect(failedIds).not.toContain(freshBuildingId);
    expect(failedIds).not.toContain(doneId);

    const rows = await migrator.db
      .select()
      .from(builds)
      .where(eq(builds.id, freshQueuedId));
    expect(rows[0]?.status).toBe('queued');
  });

  it('frees the one-active-build-per-project slot: a new build can be created for the same project afterward', async () => {
    await insertBuild({ createdAt: new Date(Date.now() - 31 * 60 * 1000) });

    // Confirms the slot really was occupied before the sweep.
    let blocked: unknown;
    try {
      await insertBuild();
    } catch (error) {
      blocked = error;
    }
    expect(blocked).toBeInstanceOf(Error);

    await callWatchdog(app.db);

    // Now the stuck build is 'failed' — the partial unique index (WHERE status IN
    // ('queued','building')) no longer covers it, so a new active build is allowed.
    await expect(insertBuild()).resolves.toBeTypeOf('string');
  });

  it("a watchdog-failed build's token stops working immediately", async () => {
    const tokenHash = `watchdog-hash-${uuidv7()}`;
    await insertBuild({
      tokenHash,
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 31 * 60 * 1000),
    });

    await callWatchdog(app.db);

    const result = await runInBuildContext(app.db, tokenHash, async () => 'should not run');
    expect(result).toBeUndefined();
  });

  it('a role without EXECUTE cannot call the function', async () => {
    // mobilio_app has no direct GRANT to run arbitrary SQL as another role, but
    // anyone connecting without the explicit GRANT (simulated here by revoking it
    // for the duration of this one test) must be rejected outright.
    await migrator.db.execute(sql`revoke execute on function public.fail_stuck_builds(int) from mobilio_app`);
    try {
      let caught: unknown;
      try {
        await app.db.execute(sql`select * from public.fail_stuck_builds(10)`);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { cause?: Error }).cause?.message).toMatch(/permission denied/i);
    } finally {
      await migrator.db.execute(sql`grant execute on function public.fail_stuck_builds(int) to mobilio_app`);
    }
  });

  it('batches: a LIMIT smaller than the number of stuck builds only fails that many per call', async () => {
    const idA = await insertBuild({ createdAt: new Date(Date.now() - 31 * 60 * 1000) });
    const idB = await insertBuild({
      projectId: project2Id,
      createdAt: new Date(Date.now() - 31 * 60 * 1000),
    });

    const firstBatch = await callWatchdog(app.db, 1);
    expect(firstBatch).toHaveLength(1);

    const secondBatch = await callWatchdog(app.db, 1);
    expect(secondBatch).toHaveLength(1);

    const thirdBatch = await callWatchdog(app.db, 1);
    expect(thirdBatch).toHaveLength(0);

    const failedIds = [...firstBatch, ...secondBatch].map((r) => r.id);
    expect(failedIds.sort()).toEqual([idA, idB].sort());
  });
});
