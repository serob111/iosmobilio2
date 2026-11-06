import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createDb, schema, eq } from '@mobilio/db';
import { cleanupExpiredEditorPreviewLinks } from '../src/preview-links-cleanup';

const hasLiveServices =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL) && Boolean(process.env.REDIS_URL);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL/REDIS_URL are not all set');
}

describe.skipIf(!hasLiveServices)('preview links cleanup (live Postgres + Redis)', () => {
  /**
   * Both rows are inserted directly as mobilio_migrator (bypassing RLS entirely) — the
   * app itself never creates an 'editor' link already in the past (expiresAt is always
   * now+2h at creation time), so an expired fixture can only exist here the same way
   * drafts-cleanup.integration.test.ts's own insertExpiredDirectly works.
   */
  async function insertDraftWithEditorLink(
    migratorDb: ReturnType<typeof createDb>['db'],
    draftId: string,
    tokenHash: string,
    linkExpiresAt: Date,
  ): Promise<string> {
    await migratorDb.insert(schema.drafts).values({
      id: draftId,
      name: 'Worker cleanup fixture',
      sourceUrl: 'https://x.example/',
      config: {},
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const linkId = randomUUID();
    await migratorDb.insert(schema.previewLinks).values({
      id: linkId,
      draftId,
      kind: 'editor',
      slugHash: `worker-itest-${randomUUID()}`,
      expiresAt: linkExpiresAt,
    });
    return linkId;
  }

  it('deletes an expired editor link, leaving an unexpired one and a share link untouched', async () => {
    const { db, pool } = createDb(process.env.DATABASE_URL!);
    const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);

    const expiredDraftId = randomUUID();
    const liveDraftId = randomUUID();
    const shareDraftId = randomUUID();

    try {
      const expiredLinkId = await insertDraftWithEditorLink(
        migrator.db,
        expiredDraftId,
        `worker-itest-${randomUUID()}`,
        new Date(Date.now() - 30_000),
      );
      const liveLinkId = await insertDraftWithEditorLink(
        migrator.db,
        liveDraftId,
        `worker-itest-${randomUUID()}`,
        new Date(Date.now() + 60_000),
      );
      // A 'share' link, also already past its own expiresAt — must survive regardless,
      // the cleanup function only ever touches kind='editor' (see 0018's RLS policy).
      await migrator.db.insert(schema.drafts).values({
        id: shareDraftId,
        name: 'Worker cleanup fixture (share)',
        sourceUrl: 'https://x.example/',
        config: {},
        tokenHash: `worker-itest-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const shareLinkId = randomUUID();
      await migrator.db.insert(schema.previewLinks).values({
        id: shareLinkId,
        draftId: shareDraftId,
        kind: 'share',
        slugHash: `worker-itest-${randomUUID()}`,
        expiresAt: new Date(Date.now() - 30_000),
      });

      const result = await cleanupExpiredEditorPreviewLinks(db);
      expect(result.deletedCount).toBeGreaterThanOrEqual(1);

      const remainingExpired = await migrator.db
        .select()
        .from(schema.previewLinks)
        .where(eq(schema.previewLinks.id, expiredLinkId));
      expect(remainingExpired).toHaveLength(0);

      const remainingLive = await migrator.db
        .select()
        .from(schema.previewLinks)
        .where(eq(schema.previewLinks.id, liveLinkId));
      expect(remainingLive).toHaveLength(1);

      const remainingShare = await migrator.db
        .select()
        .from(schema.previewLinks)
        .where(eq(schema.previewLinks.id, shareLinkId));
      expect(remainingShare).toHaveLength(1);
    } finally {
      await migrator.db.delete(schema.drafts).where(eq(schema.drafts.id, liveDraftId)).catch(() => {});
      await migrator.db.delete(schema.drafts).where(eq(schema.drafts.id, shareDraftId)).catch(() => {});
      await migrator.db.delete(schema.drafts).where(eq(schema.drafts.id, expiredDraftId)).catch(() => {});
      await pool.end();
      await migrator.pool.end();
    }
  });

  it('runs cleanupExpiredEditorPreviewLinks through a real BullMQ scheduler job, end to end', async () => {
    const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const queueName = `mobilio-preview-links-cleanup-test-${Date.now()}`;
    const queue = new Queue(queueName, { connection });
    const { db, pool } = createDb(process.env.DATABASE_URL!);

    const worker = new Worker(
      queueName,
      async (job) => {
        if (job.name === 'cleanup-expired-editor-preview-links') {
          return cleanupExpiredEditorPreviewLinks(db);
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

      await queue.upsertJobScheduler(
        'cleanup-expired-editor-preview-links',
        { every: 60_000 },
        { name: 'cleanup-expired-editor-preview-links' },
      );
      const result = (await completed) as { deletedCount: number };

      expect(result.deletedCount).toBeGreaterThanOrEqual(0);
    } finally {
      await worker.close();
      await queue.close();
      connection.disconnect();
      await pool.end();
    }
  }, 15_000);
});
