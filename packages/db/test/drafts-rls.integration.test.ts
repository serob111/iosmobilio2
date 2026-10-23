import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, lt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createDb } from '../src/client';
import { runInTokenLookupContext, getTenantDb } from '../src/tenant-context';
import { drafts } from '../src/schema';

// See packages/db/test/tenant-context.integration.test.ts for why this skips locally
// but hard-fails in CI when REQUIRE_LIVE_SERVICES=true.
const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL);
if (!hasLiveDb && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL are not set');
}

describe.skipIf(!hasLiveDb)('drafts RLS (live Postgres)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
  const app = createDb(process.env.DATABASE_URL!);

  afterAll(async () => {
    await migrator.db.delete(drafts);
    await migrator.pool.end();
    await app.pool.end();
  });

  beforeEach(async () => {
    await migrator.db.delete(drafts);
  });

  it('a direct query outside any token context sees zero drafts (fail closed)', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await runInTokenLookupContext(migrator.db, tokenHash, async () => {
      await getTenantDb().insert(drafts).values({
        name: 'Draft',
        sourceUrl: 'https://example.com',
        config: { trial: true },
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    });

    const seen = await app.db.select().from(drafts);
    expect(seen).toHaveLength(0);
  });

  it('only the matching claim token can see its own draft, not another one', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    const otherTokenHash = `test-hash-${uuidv7()}`;
    await runInTokenLookupContext(migrator.db, tokenHash, async () => {
      await getTenantDb().insert(drafts).values({
        name: 'Mine',
        sourceUrl: 'https://example.com',
        config: {},
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    });

    const seenByOwner = await runInTokenLookupContext(app.db, tokenHash, () =>
      getTenantDb().select().from(drafts).where(eq(drafts.tokenHash, tokenHash)),
    );
    expect(seenByOwner).toHaveLength(1);
    expect(seenByOwner[0]?.name).toBe('Mine');

    const seenByOther = await runInTokenLookupContext(app.db, otherTokenHash, () =>
      getTenantDb().select().from(drafts).where(eq(drafts.tokenHash, tokenHash)),
    );
    expect(seenByOther).toHaveLength(0);
  });

  it('WITH CHECK rejects inserting a draft under a token context that does not match its own token_hash', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    const otherTokenHash = `test-hash-${uuidv7()}`;

    let caught: unknown;
    try {
      await runInTokenLookupContext(app.db, otherTokenHash, async () => {
        await getTenantDb().insert(drafts).values({
          name: 'Mismatched',
          sourceUrl: 'https://example.com',
          config: {},
          tokenHash,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { cause?: Error }).cause?.message).toMatch(/row-level security/i);
  });

  it('an expired draft can be deleted through an unscoped connection with no token context at all', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await runInTokenLookupContext(migrator.db, tokenHash, async () => {
      await getTenantDb().insert(drafts).values({
        name: 'Expired',
        sourceUrl: 'https://example.com',
        config: {},
        tokenHash,
        expiresAt: new Date(Date.now() - 1_000),
      });
    });

    const deleted = await app.db.delete(drafts).where(lt(drafts.expiresAt, new Date())).returning();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.name).toBe('Expired');
  });

  it('an unscoped connection cannot delete a draft that has not expired yet', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await runInTokenLookupContext(migrator.db, tokenHash, async () => {
      await getTenantDb().insert(drafts).values({
        name: 'Still Valid',
        sourceUrl: 'https://example.com',
        config: {},
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    });

    const deleted = await app.db.delete(drafts).where(lt(drafts.expiresAt, new Date())).returning();
    expect(deleted).toHaveLength(0);

    const stillThere = await runInTokenLookupContext(app.db, tokenHash, () =>
      getTenantDb().select().from(drafts).where(eq(drafts.tokenHash, tokenHash)),
    );
    expect(stillThere).toHaveLength(1);
  });
});
