import { sql, type Db } from '@mobilio/db';

export type BuildsWatchdogResult = { failedCount: number; failedIds: string[] };

const BATCH_SIZE = 200;

/**
 * Calls the SECURITY DEFINER public.fail_stuck_builds(batch) function (see
 * packages/db/migrations/0012_builds_watchdog.sql) — a build whose runner died
 * silently (crashed workflow, network partition before its first/next callback) never
 * calls /fail, so it sits in 'queued'/'building' forever, permanently occupying
 * builds_one_active_per_project's one active-build slot for that project. Loops in
 * batches rather than one unbounded sweep so a large backlog doesn't hold one huge
 * transaction/lock for the whole pass — same shape as cleanupExpiredDrafts.
 */
export async function failStuckBuilds(db: Db): Promise<BuildsWatchdogResult> {
  const failedIds: string[] = [];

  for (;;) {
    const result = await db.execute<{ id: string }>(sql`select * from public.fail_stuck_builds(${BATCH_SIZE})`);
    const rows = result.rows;
    if (rows.length === 0) {
      break;
    }
    failedIds.push(...rows.map((row) => row.id));

    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  return { failedCount: failedIds.length, failedIds };
}
