import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createDb } from '../src/client';
import { runInTenantContext, runInUserContext, runInTokenLookupContext, getTenantDb } from '../src/tenant-context';
import { organizations, memberships, invitations, users } from '../src/schema';

// Only runs when a real mobilio_app + mobilio_migrator pair is reachable (CI runs
// packages/db's migration pipeline against its services: postgres container first —
// see .github/workflows/ci.yml). Locally this just skips: plain `npm test` shouldn't
// require live infrastructure or the role bootstrap having been run.
const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);

describe.skipIf(!hasLiveDb)('runInTenantContext (live Postgres, RLS)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);

  const userId = `tenant-ctx-test-${uuidv7()}`;
  const orgAId = uuidv7();
  const orgBId = uuidv7();

  beforeAll(async () => {
    await migrator.db.insert(users).values({ id: userId, name: 'Tenant Ctx Test', email: `${userId}@example.com` });

    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(organizations).values({ id: orgAId, name: 'Org A', slug: `org-a-${orgAId}` });
      await tx.insert(memberships).values({ userId, orgId: orgAId, role: 'owner' });
    });

    await runInTenantContext(migrator.db, { orgId: orgBId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(organizations).values({ id: orgBId, name: 'Org B', slug: `org-b-${orgBId}` });
      await tx.insert(memberships).values({ userId, orgId: orgBId, role: 'owner' });
    });
  });

  afterAll(async () => {
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
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

  it('only sees the active tenant\'s rows through the mobilio_app role', async () => {
    const seenFromA = await runInTenantContext(app.db, { orgId: orgAId, userId }, () =>
      getTenantDb().select().from(memberships),
    );
    expect(seenFromA).toHaveLength(1);
    expect(seenFromA[0]?.orgId).toBe(orgAId);

    const seenFromB = await runInTenantContext(app.db, { orgId: orgBId, userId }, () =>
      getTenantDb().select().from(memberships),
    );
    expect(seenFromB).toHaveLength(1);
    expect(seenFromB[0]?.orgId).toBe(orgBId);
  });

  it('sees nothing for an org_id that was never granted membership', async () => {
    const strangerOrgId = uuidv7();
    const seen = await runInTenantContext(app.db, { orgId: strangerOrgId, userId }, () =>
      getTenantDb().select().from(memberships),
    );
    expect(seen).toHaveLength(0);
  });

  it('runInUserContext sees the user\'s own rows across every org (for "list my orgs")', async () => {
    const seen = await runInUserContext(app.db, userId, () =>
      getTenantDb().select({ orgId: memberships.orgId }).from(memberships),
    );
    const orgIds = seen.map((row) => row.orgId).sort();
    expect(orgIds).toEqual([orgAId, orgBId].sort());
  });

  it('runInUserContext cannot be used to write a membership into another org', async () => {
    let caught: unknown;
    try {
      await runInUserContext(app.db, userId, () =>
        getTenantDb().insert(memberships).values({ userId, orgId: uuidv7(), role: 'owner' }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { cause?: Error }).cause?.message).toMatch(/row-level security/i);
  });

  it('runInTokenLookupContext finds an invitation by token hash alone, across orgs', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    const expiresAt = new Date(Date.now() + 60_000);
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
      await getTenantDb()
        .insert(invitations)
        .values({ orgId: orgAId, email: 'invitee@example.com', role: 'member', tokenHash, expiresAt });
    });

    const found = await runInTokenLookupContext(app.db, tokenHash, () =>
      getTenantDb().select().from(invitations).where(eq(invitations.tokenHash, tokenHash)),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.orgId).toBe(orgAId);

    const notFound = await runInTokenLookupContext(app.db, 'no-such-hash', () =>
      getTenantDb().select().from(invitations).where(eq(invitations.tokenHash, 'no-such-hash')),
    );
    expect(notFound).toHaveLength(0);

    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
      await getTenantDb().delete(invitations);
    });
  });
});
