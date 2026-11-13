import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createDb, runInTokenLookupContext, getTenantDb, schema, eq } from '@mobilio/db';
import { createObjectStorageFromEnv, draftIconKey } from '@mobilio/storage';
import { cleanupExpiredDrafts } from '../src/drafts-cleanup';

// Same REQUIRE_LIVE_SERVICES convention as test/integration.redis.test.ts — this file
// additionally needs a real Postgres (both mobilio_app and mobilio_migrator — an
// already-expired fixture row can only be inserted by bypassing RLS, see
// insertExpiredDirectly below) and MinIO/S3, since the cleanup job touches both.
const hasLiveServices =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.MIGRATOR_DATABASE_URL) &&
  Boolean(process.env.REDIS_URL) &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_BUCKET) &&
  Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error(
    'REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL/REDIS_URL/S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not all set',
  );
}

describe.skipIf(!hasLiveServices)('drafts cleanup (live Postgres + Redis + MinIO)', () => {
  /**
   * drafts_token_access's WITH CHECK now requires expires_at > now() (see
   * packages/db/migrations/0007_drafts_rls_fix.sql), so an already-expired row can't be
   * created through the normal, token-scoped app-role insert path at all — only by
   * bypassing RLS entirely, which only mobilio_migrator (the table owner) can do.
   */
  async function insertExpiredDirectly(
    migratorDb: ReturnType<typeof createDb>['db'],
    id: string,
    tokenHash: string,
  ): Promise<void> {
    await migratorDb.insert(schema.drafts).values({
      id,
      name: 'Expired',
      sourceUrl: 'https://x.example/',
      config: {},
      tokenHash,
      // 30s margin, not 1s — comfortably outlasts ordinary host/container clock skew
      // (e.g. right after a Docker Desktop/WSL2 restart) so this doesn't flake.
      expiresAt: new Date(Date.now() - 30_000),
    });
  }

  it('deletes an expired draft row and its icon object, leaving an unexpired one untouched', async () => {
    const { db, pool } = createDb(process.env.DATABASE_URL!);
    const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);
    const storage = createObjectStorageFromEnv();

    const expiredId = randomUUID();
    const expiredTokenHash = `worker-itest-${randomUUID()}`;
    const liveId = randomUUID();
    const liveTokenHash = `worker-itest-${randomUUID()}`;

    try {
      await insertExpiredDirectly(migrator.db, expiredId, expiredTokenHash);
      await runInTokenLookupContext(db, liveTokenHash, () =>
        getTenantDb().insert(schema.drafts).values({
          id: liveId,
          name: 'Still valid',
          sourceUrl: 'https://x.example/',
          config: {},
          tokenHash: liveTokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );
      await storage.put(draftIconKey(expiredId), Buffer.from('icon'), 'image/png');

      const result = await cleanupExpiredDrafts(db, storage);
      expect(result.deletedCount).toBeGreaterThanOrEqual(1);
      expect(result.iconDeleteFailures).toBe(0);

      const remainingExpired = await migrator.db.select().from(schema.drafts).where(eq(schema.drafts.id, expiredId));
      expect(remainingExpired).toHaveLength(0);
      await expect(storage.get(draftIconKey(expiredId))).rejects.toThrow();

      const remainingLive = await runInTokenLookupContext(db, liveTokenHash, () =>
        getTenantDb().select().from(schema.drafts).where(eq(schema.drafts.tokenHash, liveTokenHash)),
      );
      expect(remainingLive).toHaveLength(1);
    } finally {
      await migrator.db.delete(schema.drafts).where(eq(schema.drafts.id, liveId)).catch(() => {});
      await pool.end();
      await migrator.pool.end();
    }
  });

  it('runs cleanupExpiredDrafts through a real BullMQ scheduler job, end to end', async () => {
    const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const queueName = `mobilio-drafts-cleanup-test-${Date.now()}`;
    const queue = new Queue(queueName, { connection });
    const { db, pool } = createDb(process.env.DATABASE_URL!);
    const storage = createObjectStorageFromEnv();

    const worker = new Worker(
      queueName,
      async (job) => {
        if (job.name === 'cleanup-expired-drafts') {
          return cleanupExpiredDrafts(db, storage);
        }
        return null;
      },
      { connection },
    );

    try {
      const completed = new Promise<unknown>((resolve, reject) => {
        worker.on('completed', (_job, result) => resolve(result));
        worker.on('failed', (_job, err) => reject(err));
      });

      await queue.upsertJobScheduler('cleanup-expired-drafts', { every: 60_000 }, { name: 'cleanup-expired-drafts' });
      const result = (await completed) as { deletedCount: number; iconDeleteFailures: number };

      expect(result.deletedCount).toBeGreaterThanOrEqual(0);
      expect(result.iconDeleteFailures).toBeGreaterThanOrEqual(0);
    } finally {
      await worker.close();
      await queue.close();
      connection.disconnect();
      await pool.end();
    }
  }, 15_000);
});
