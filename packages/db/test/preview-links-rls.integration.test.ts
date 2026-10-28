import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createDb } from '../src/client';
import {
  runInTenantContext,
  runInTokenLookupContext,
  runInPreviewLookupContext,
  getTenantDb,
} from '../src/tenant-context';
import { organizations, memberships, users, projects, drafts, previewLinks } from '../src/schema';

const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);
if (!hasLiveDb && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL are not set');
}

describe.skipIf(!hasLiveDb)('preview_links RLS (live Postgres)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);

  const userId = `preview-links-test-${uuidv7()}`;
  const orgAId = uuidv7();
  const orgBId = uuidv7();
  let projectAId: string;
  let projectA2Id: string;

  beforeAll(async () => {
    await migrator.db.insert(users).values({ id: userId, name: 'Preview Links Test', email: `${userId}@example.com` });

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
      projectA2Id = uuidv7();
      await tx.insert(projects).values({
        id: projectA2Id,
        orgId: orgAId,
        name: 'Project A2',
        sourceUrl: 'https://a2.example/',
        config: { id: projectA2Id, name: 'Project A2' },
      });
    });

    await runInTenantContext(migrator.db, { orgId: orgBId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(organizations).values({ id: orgBId, name: 'Org B', slug: `org-b-${orgBId}` });
      await tx.insert(memberships).values({ userId, orgId: orgBId, role: 'owner' });
    });
  });

  beforeEach(async () => {
    // One active link per project/draft (partial unique index) — a leftover row from a
    // previous test would spuriously trip it in the next one.
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () => getTenantDb().delete(previewLinks));
    await migrator.db.delete(drafts);
  });

  afterAll(async () => {
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, async () => {
      await getTenantDb().delete(projects);
      await getTenantDb().delete(memberships);
    });
    await runInTenantContext(migrator.db, { orgId: orgBId, userId }, () => getTenantDb().delete(memberships));
    await migrator.db.delete(organizations);
    await migrator.db.delete(users);
    await migrator.pool.end();
    await app.pool.end();
  });

  async function insertDraft(tokenHash: string, overrides: Partial<typeof drafts.$inferInsert> = {}): Promise<string> {
    const id = uuidv7();
    await runInTokenLookupContext(migrator.db, tokenHash, () =>
      getTenantDb().insert(drafts).values({
        id,
        name: 'Draft',
        sourceUrl: 'https://draft.example/',
        config: {},
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
        ...overrides,
      }),
    );
    return id;
  }

  async function insertProjectLink(
    slugHash: string,
    overrides: Partial<typeof previewLinks.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7();
    await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
      getTenantDb().insert(previewLinks).values({
        id,
        orgId: orgAId,
        projectId: projectAId,
        slugHash,
        ...overrides,
      }),
    );
    return id;
  }

  async function insertDraftLink(
    tokenHash: string,
    draftId: string,
    slugHash: string,
    overrides: Partial<typeof previewLinks.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7();
    await runInTokenLookupContext(migrator.db, tokenHash, () =>
      getTenantDb().insert(previewLinks).values({ id, draftId, slugHash, ...overrides }),
    );
    return id;
  }

  describe('CHECK preview_links_exactly_one_owner', () => {
    it('rejects a row with neither project_id nor draft_id', async () => {
      const caught: unknown = await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
        getTenantDb().insert(previewLinks).values({ orgId: orgAId, slugHash: `hash-${uuidv7()}` }),
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { cause?: Error }).cause?.message).toMatch(/preview_links_exactly_one_owner/i);
    });

    it('rejects a row with both project_id and draft_id', async () => {
      const tokenHash = `test-hash-${uuidv7()}`;
      const draftId = await insertDraft(tokenHash);
      const caught: unknown = await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
        getTenantDb()
          .insert(previewLinks)
          .values({ orgId: orgAId, projectId: projectAId, draftId, slugHash: `hash-${uuidv7()}` }),
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { cause?: Error }).cause?.message).toMatch(/preview_links_exactly_one_owner/i);
    });
  });

  describe('org-scoped (project) access', () => {
    it('only the owning org can see its project link, not another org', async () => {
      const slugHash = `hash-${uuidv7()}`;
      await insertProjectLink(slugHash);

      const seenByOwner = await runInTenantContext(app.db, { orgId: orgAId, userId }, () =>
        getTenantDb().select().from(previewLinks).where(eq(previewLinks.slugHash, slugHash)),
      );
      expect(seenByOwner).toHaveLength(1);

      const seenByOther = await runInTenantContext(app.db, { orgId: orgBId, userId }, () =>
        getTenantDb().select().from(previewLinks).where(eq(previewLinks.slugHash, slugHash)),
      );
      expect(seenByOther).toHaveLength(0);
    });

    it('the partial unique index rejects a second active link for the same project', async () => {
      await insertProjectLink(`hash-${uuidv7()}`);
      const caught: unknown = await insertProjectLink(`hash-${uuidv7()}`).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { cause?: Error }).cause?.message).toMatch(/preview_links_one_active_per_project/i);
    });

    it('regenerating (revoke then insert) frees the slot for a new active link', async () => {
      const firstId = await insertProjectLink(`hash-${uuidv7()}`);
      await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
        getTenantDb().update(previewLinks).set({ revokedAt: new Date() }).where(eq(previewLinks.id, firstId)),
      );

      await expect(insertProjectLink(`hash-${uuidv7()}`)).resolves.toBeTypeOf('string');
    });
  });

  describe('draft-token-scoped access', () => {
    it("only the matching draft token can see its own draft's link, not another one", async () => {
      const tokenHash = `test-hash-${uuidv7()}`;
      const otherTokenHash = `test-hash-${uuidv7()}`;
      const draftId = await insertDraft(tokenHash);
      const slugHash = `hash-${uuidv7()}`;
      await insertDraftLink(tokenHash, draftId, slugHash);

      const seenByOwner = await runInTokenLookupContext(app.db, tokenHash, () =>
        getTenantDb().select().from(previewLinks).where(eq(previewLinks.slugHash, slugHash)),
      );
      expect(seenByOwner).toHaveLength(1);

      const seenByOther = await runInTokenLookupContext(app.db, otherTokenHash, () =>
        getTenantDb().select().from(previewLinks).where(eq(previewLinks.slugHash, slugHash)),
      );
      expect(seenByOther).toHaveLength(0);
    });

    it('the partial unique index rejects a second active link for the same draft', async () => {
      const tokenHash = `test-hash-${uuidv7()}`;
      const draftId = await insertDraft(tokenHash);
      await insertDraftLink(tokenHash, draftId, `hash-${uuidv7()}`);
      const caught: unknown = await insertDraftLink(tokenHash, draftId, `hash-${uuidv7()}`).catch(
        (error: unknown) => error,
      );
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { cause?: Error }).cause?.message).toMatch(/preview_links_one_active_per_draft/i);
    });
  });

  describe('runInPreviewLookupContext (public GET /preview/:slug reader)', () => {
    it("finds a project-backed link by slug and can read exactly that project (not a sibling), with no app.org_id set", async () => {
      const slugHash = `hash-${uuidv7()}`;
      await insertProjectLink(slugHash);

      const project = await runInPreviewLookupContext(app.db, slugHash, async (link) => {
        expect(link.projectId).toBe(projectAId);
        const [row] = await getTenantDb().select().from(projects).where(eq(projects.id, projectAId));
        return row;
      });
      expect(project?.id).toBe(projectAId);

      const sibling = await runInPreviewLookupContext(app.db, slugHash, () =>
        getTenantDb().select().from(projects).where(eq(projects.id, projectA2Id)),
      );
      expect(sibling).toHaveLength(0);
    });

    it("finds a draft-backed link by slug and can read exactly that draft, with no app.lookup_token_hash set", async () => {
      const tokenHash = `test-hash-${uuidv7()}`;
      const draftId = await insertDraft(tokenHash);
      const slugHash = `hash-${uuidv7()}`;
      await insertDraftLink(tokenHash, draftId, slugHash);

      const draft = await runInPreviewLookupContext(app.db, slugHash, async (link) => {
        expect(link.draftId).toBe(draftId);
        const [row] = await getTenantDb().select().from(drafts).where(eq(drafts.id, draftId));
        return row;
      });
      expect(draft?.id).toBe(draftId);
    });

    it('returns undefined for an unknown slug', async () => {
      const result = await runInPreviewLookupContext(app.db, `no-such-hash-${uuidv7()}`, async () => 'should not run');
      expect(result).toBeUndefined();
    });

    it('returns undefined for a revoked link', async () => {
      const slugHash = `hash-${uuidv7()}`;
      const id = await insertProjectLink(slugHash);
      await runInTenantContext(migrator.db, { orgId: orgAId, userId }, () =>
        getTenantDb().update(previewLinks).set({ revokedAt: new Date() }).where(eq(previewLinks.id, id)),
      );

      const result = await runInPreviewLookupContext(app.db, slugHash, async () => 'should not run');
      expect(result).toBeUndefined();
    });

    it('returns undefined for an expired link', async () => {
      const slugHash = `hash-${uuidv7()}`;
      await insertProjectLink(slugHash, { expiresAt: new Date(Date.now() - 30_000) });

      const result = await runInPreviewLookupContext(app.db, slugHash, async () => 'should not run');
      expect(result).toBeUndefined();
    });
  });

  it('a direct query outside any context sees zero preview_links (fail closed)', async () => {
    await insertProjectLink(`hash-${uuidv7()}`);
    const seen = await app.db.select().from(previewLinks);
    expect(seen).toHaveLength(0);
  });
});
