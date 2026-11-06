import { sql, type Db } from '@mobilio/db';

export type PreviewLinksCleanupResult = { deletedCount: number };

const BATCH_SIZE = 500;

/**
 * Calls the SECURITY DEFINER public.cleanup_expired_editor_preview_links(batch) function
 * (see packages/db/migrations/0018_preview_links_editor_cleanup.sql) — same reasoning as
 * cleanupExpiredDrafts: mobilio_app's own RLS policies can't see an expired 'editor' link
 * at all, only this function (running as the table owner) can. Scoped to kind='editor'
 * only — 'share' links either have no expiry or get cascade-deleted with their draft
 * already, there's nothing else for this job to sweep.
 */
export async function cleanupExpiredEditorPreviewLinks(db: Db): Promise<PreviewLinksCleanupResult> {
  let deletedCount = 0;

  for (;;) {
    const result = await db.execute<{ id: string }>(
      sql`select * from public.cleanup_expired_editor_preview_links(${BATCH_SIZE})`,
    );
    const rows = result.rows;
    if (rows.length === 0) {
      break;
    }
    deletedCount += rows.length;

    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  return { deletedCount };
}
