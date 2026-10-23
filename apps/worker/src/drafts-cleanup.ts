import { lt, schema, type Db } from '@mobilio/db';
import { draftIconKey, type ObjectStorage } from '@mobilio/storage';

export type DraftsCleanupResult = { deletedCount: number; iconDeleteFailures: number };

/**
 * Deletes every draft past its expiry and best-effort removes its icon object too — the
 * DB delete is the authoritative step (an expired row is already inaccessible via RLS to
 * anything but this unscoped connection), so a failed icon delete just leaves an orphaned
 * object rather than blocking or rolling back the rest of the batch.
 */
export async function cleanupExpiredDrafts(db: Db, storage: ObjectStorage): Promise<DraftsCleanupResult> {
  const deleted = await db
    .delete(schema.drafts)
    .where(lt(schema.drafts.expiresAt, new Date()))
    .returning({ id: schema.drafts.id });

  const results = await Promise.allSettled(deleted.map((row) => storage.delete(draftIconKey(row.id))));
  const iconDeleteFailures = results.filter((r) => r.status === 'rejected').length;

  return { deletedCount: deleted.length, iconDeleteFailures };
}
