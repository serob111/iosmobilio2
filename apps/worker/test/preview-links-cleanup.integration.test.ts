import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createDb, schema, eq, runInTokenLookupContext, getTenantDb } from '@mobilio/db';
import { cleanupExpiredEditorPreviewLinks } from '../src/preview-links-cleanup';

const hasLiveServices =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.MIGRATOR_DATABASE_URL) && Boolean(process.env.REDIS_URL);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL/REDIS_URL are not all set');
}

describe.skipIf(!hasLiveServices)('preview links cleanup (live Postgres + Redis)', () => {
  /**
   * Inserted through the normal app-role `db` + a token-lookup context (not
   * mobilio_migrator) — drafts_token_access's WITH CHECK only requires the draft's own
   * expires_at to be in the future (true for every fixture here; only the *link's* own
   * expiresAt varies) and the token_hash to match, both satisfied by this context.
   * preview_links_draft_access similarly only requires the referenced draft to be
   * valid under that same context — neither policy restricts what expiresAt value a new
   * preview_links row itself may carry, so a past one inserts here exactly as the app
   * would never normally do itself (createEditorLinkForDraft always sets now()+2h) but
   * CAN be constructed this way for the fixture.
   *
   * Crucially, reading a *non-expired* row back (or deleting it) also requires this same
   * token context — mobilio_migrator has no bypass policy for an unexpired draft/link
   * (drafts_cleanup/preview_links_cleanup only cover already-expired rows), so every
   * read/cleanup of the "live"/"share" fixtures below goes through the same context,
   * never a bare migrator query.
   */
  async function insertDraftWithEditorLink(
    db: ReturnType<typeof createDb>['db'],
    draftId: string,
    tokenHash: string,
    linkExpiresAt: Date,
  ): Promise<string> {
    const linkId = randomUUID();
    await runInTokenLookupContext(db, tokenHash, async () => {
      const tx = getTenantDb();
      await tx.insert(schema.drafts).values({
        id: draftId,
        name: 'Worker cleanup fixture',
        sourceUrl: 'https://x.example/',
        config: {},
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await tx.insert(schema.previewLinks).values({
        id: linkId,
        draftId,
        kind: 'editor',
        slugHash: `worker-itest-${randomUUID()}`,
        expiresAt: linkExpiresAt,
      });
    });
    return linkId;
  }

  it('deletes an expired editor link, leaving an unexpired one and a share link untouched', async () => {
    const { db, pool } = createDb(process.env.DATABASE_URL!);
    const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);

    const expiredDraftId = randomUUID();
    const liveDraftId = randomUUID();
    const shareDraftId = randomUUID();
    const expiredTokenHash = `worker-itest-${randomUUID()}`;
    const liveTokenHash = `worker-itest-${randomUUID()}`;
    const shareTokenHash = `worker-itest-${randomUUID()}`;

    try {
      const expiredLinkId = await insertDraftWithEditorLink(
        db,
        expiredDraftId,
        expiredTokenHash,
        new Date(Date.now() - 30_000),
      );
      const liveLinkId = await insertDraftWithEditorLink(db, liveDraftId, liveTokenHash, new Date(Date.now() + 60_000));

      // A 'share' link, also already past its own expiresAt — must survive regardless,
      // the cleanup function only ever touches kind='editor' (see 0018's RLS policy).
      const shareLinkId = randomUUID();
      await runInTokenLookupContext(db, shareTokenHash, async () => {
        const tx = getTenantDb();
        await tx.insert(schema.drafts).values({
          id: shareDraftId,
          name: 'Worker cleanup fixture (share)',
          sourceUrl: 'https://x.example/',
          config: {},
          tokenHash: shareTokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });
        await tx.insert(schema.previewLinks).values({
          id: shareLinkId,
          draftId: shareDraftId,
          kind: 'share',
          slugHash: `worker-itest-${randomUUID()}`,
          expiresAt: new Date(Date.now() - 30_000),
        });
      });

      const result = await cleanupExpiredEditorPreviewLinks(db);
      expect(result.deletedCount).toBeGreaterThanOrEqual(1);

      // The expired link's own row is gone — a bare migrator read is fine here since
      // preview_links_cleanup (0018) covers exactly "editor, already expired", and
      // either way the row genuinely no longer exists.
      const remainingExpired = await migrator.db
        .select()
        .from(schema.previewLinks)
        .where(eq(schema.previewLinks.id, expiredLinkId));
      expect(remainingExpired).toHaveLength(0);

      // The live editor link and the share link are both still *unexpired* rows —
      // mobilio_migrator has no policy granting it visibility into those at all, so
      // these reads go through the same token context that created them.
      const remainingLive = await runInTokenLookupContext(db, liveTokenHash, () =>
        getTenantDb().select().from(schema.previewLinks).where(eq(schema.previewLinks.id, liveLinkId)),
      );
      expect(remainingLive).toHaveLength(1);

      const remainingShare = await runInTokenLookupContext(db, shareTokenHash, () =>
        getTenantDb().select().from(schema.previewLinks).where(eq(schema.previewLinks.id, shareLinkId)),
      );
      expect(remainingShare).toHaveLength(1);
    } finally {
      // Each draft is still unexpired, so only its own token context (not a bare
      // migrator delete) can remove it.
      await runInTokenLookupContext(db, liveTokenHash, () =>
        getTenantDb().delete(schema.drafts).where(eq(schema.drafts.id, liveDraftId)),
      ).catch(() => {});
      await runInTokenLookupContext(db, shareTokenHash, () =>
        getTenantDb().delete(schema.drafts).where(eq(schema.drafts.id, shareDraftId)),
      ).catch(() => {});
      await runInTokenLookupContext(db, expiredTokenHash, () =>
        getTenantDb().delete(schema.drafts).where(eq(schema.drafts.id, expiredDraftId)),
      ).catch(() => {});
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
