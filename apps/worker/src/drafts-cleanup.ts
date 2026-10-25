import { sql, type Db } from '@mobilio/db';
import { draftIconKey, type ObjectStorage } from '@mobilio/storage';

export type DraftsCleanupResult = { deletedCount: number; iconDeleteFailures: number };

const BATCH_SIZE = 500;

/**
 * Calls the SECURITY DEFINER public.cleanup_expired_drafts(batch) function (see
 * packages/db/migrations/0007_drafts_rls_fix.sql) instead of deleting through Drizzle
 * directly — mobilio_app's own RLS policy (drafts_token_access) now requires a matching,
 * unexpired token, so an ordinary app connection can no longer see expired rows at all;
 * only this function (running as the table owner) can. Loops in batches rather than one
 * unbounded delete so a large backlog doesn't hold one huge transaction/lock for the
 * whole sweep.
 */
export async function cleanupExpiredDrafts(db: Db, storage: ObjectStorage): Promise<DraftsCleanupResult> {
  let deletedCount = 0;
  let iconDeleteFailures = 0;

  for (;;) {
    const result = await db.execute<{ id: string }>(sql`select * from public.cleanup_expired_drafts(${BATCH_SIZE})`);
    const rows = result.rows;
    if (rows.length === 0) {
      break;
    }
    deletedCount += rows.length;

    const outcomes = await Promise.allSettled(rows.map((row) => storage.delete(draftIconKey(row.id))));
    iconDeleteFailures += outcomes.filter((outcome) => outcome.status === 'rejected').length;

    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  return { deletedCount, iconDeleteFailures };
}
