import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
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

// Only the "no grant at all" test below needs superuser rights to create/drop a
// throwaway role — gated separately so the rest of this file doesn't need it.
const hasBootstrap = Boolean(process.env.POSTGRES_BOOTSTRAP_URL);
if (!hasBootstrap && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but POSTGRES_BOOTSTRAP_URL is not set');
}

function withCredentials(baseUrl: string, username: string, password: string): string {
  const url = new URL(baseUrl);
  url.username = username;
  url.password = password;
  return url.toString();
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
    // Only actually deletes already-expired rows — drafts_cleanup (0007) is scoped TO
    // mobilio_migrator and only applies to expired rows; FORCE ROW LEVEL SECURITY stays
    // on, so migrator gets no blanket owner exemption and this leaves any non-expired
    // fixture row from a previous test in place. That's harmless here: every test uses
    // its own unique tokenHash, and RLS hides those leftovers from the unscoped
    // selects/assertions below regardless of how many accumulate.
    await migrator.db.delete(drafts);
  });

  /**
   * expiresAt in the past can't go through the token-scoped insert path anymore — the
   * WITH CHECK clause on drafts_token_access now requires expires_at > now(). Inserting
   * directly as migrator, with no token context, still succeeds: drafts_cleanup is
   * FOR ALL (not just FOR DELETE), and Postgres uses its USING clause as the WITH CHECK
   * too when none is given separately — so an insert of an already-expired row passes
   * via drafts_cleanup even though it fails drafts_token_access.
   */
  async function insertExpiredDirectly(tokenHash: string): Promise<string> {
    const id = uuidv7();
    await migrator.db.insert(drafts).values({
      id,
      name: 'Expired',
      sourceUrl: 'https://example.com',
      config: {},
      tokenHash,
      // 30s margin, not 1s — comfortably outlasts ordinary host/container clock skew
      // (e.g. right after a Docker Desktop/WSL2 restart) so this doesn't flake.
      expiresAt: new Date(Date.now() - 30_000),
    });
    return id;
  }

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

  it('WITH CHECK rejects inserting an already-expired draft even under its own matching token context', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;

    let caught: unknown;
    try {
      await runInTokenLookupContext(app.db, tokenHash, async () => {
        await getTenantDb().insert(drafts).values({
          name: 'Born expired',
          sourceUrl: 'https://example.com',
          config: {},
          tokenHash,
          // 30s margin, not 1s — comfortably outlasts ordinary host/container clock skew
      // (e.g. right after a Docker Desktop/WSL2 restart) so this doesn't flake.
      expiresAt: new Date(Date.now() - 30_000),
        });
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { cause?: Error }).cause?.message).toMatch(/row-level security/i);
  });

  it('mobilio_app with no context at all sees zero drafts, including expired ones', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await insertExpiredDirectly(tokenHash);

    const seen = await app.db.select().from(drafts);
    expect(seen).toHaveLength(0);
  });

  it('an expired draft is invisible, and un-updatable, even with its own correct token', async () => {
    const tokenHash = `test-hash-${uuidv7()}`;
    await insertExpiredDirectly(tokenHash);

    const seen = await runInTokenLookupContext(app.db, tokenHash, () =>
      getTenantDb().select().from(drafts).where(eq(drafts.tokenHash, tokenHash)),
    );
    expect(seen).toHaveLength(0);

    const updated = await runInTokenLookupContext(app.db, tokenHash, () =>
      getTenantDb().update(drafts).set({ name: 'Hijacked' }).where(eq(drafts.tokenHash, tokenHash)).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it('cleanup_expired_drafts() deletes only expired rows, leaving live ones untouched', async () => {
    const expiredTokenHash = `test-hash-${uuidv7()}`;
    const liveTokenHash = `test-hash-${uuidv7()}`;
    const expiredId = await insertExpiredDirectly(expiredTokenHash);
    await runInTokenLookupContext(migrator.db, liveTokenHash, async () => {
      await getTenantDb().insert(drafts).values({
        name: 'Still valid',
        sourceUrl: 'https://example.com',
        config: {},
        tokenHash: liveTokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    });

    // Via the app role, not the migrator — proving the GRANT EXECUTE actually lets
    // mobilio_app call this despite being otherwise unable to see expired rows at all.
    const result = await app.db.execute<{ id: string }>(sql`select * from public.cleanup_expired_drafts(500)`);
    const deletedIds = result.rows.map((row) => row.id);
    expect(deletedIds).toContain(expiredId);

    const remainingLive = await runInTokenLookupContext(app.db, liveTokenHash, () =>
      getTenantDb().select().from(drafts).where(eq(drafts.tokenHash, liveTokenHash)),
    );
    expect(remainingLive).toHaveLength(1);
  });

  it.skipIf(!hasBootstrap)(
    "a role with no grant at all cannot call cleanup_expired_drafts (Postgres's default PUBLIC EXECUTE was revoked)",
    async () => {
      const bootstrap = createDb(process.env.POSTGRES_BOOTSTRAP_URL!);
      const roleName = `drafts_itest_norights_${Date.now()}`;

      try {
        await bootstrap.db.execute(sql.raw(`CREATE ROLE "${roleName}" LOGIN PASSWORD 'test-only-pw'`));
        await bootstrap.db.execute(sql.raw(`GRANT CONNECT ON DATABASE mobilio TO "${roleName}"`));
        await bootstrap.db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO "${roleName}"`));

        const unauthorized = createDb(withCredentials(process.env.POSTGRES_BOOTSTRAP_URL!, roleName, 'test-only-pw'));
        try {
          const caught: unknown = await unauthorized.db
            .execute(sql`select * from public.cleanup_expired_drafts(500)`)
            .catch((error) => error);
          expect(caught).toBeInstanceOf(Error);
          expect((caught as { cause?: Error }).cause?.message).toMatch(/permission denied/i);
        } finally {
          await unauthorized.pool.end();
        }
      } finally {
        // DROP ROLE fails outright while the role still owns any ACL entries (the
        // CONNECT/USAGE grants above) — DROP OWNED BY revokes those first.
        await bootstrap.db.execute(sql.raw(`DROP OWNED BY "${roleName}"`));
        await bootstrap.db.execute(sql.raw(`DROP ROLE IF EXISTS "${roleName}"`));
        await bootstrap.pool.end();
      }
    },
  );
});
