import 'dotenv/config';
import './instrumentation';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { createDb } from '@mobilio/db';
import { createObjectStorageFromEnv } from '@mobilio/storage';
import { processPingJob, type PingJobData } from './processors';
import { cleanupExpiredDrafts } from './drafts-cleanup';
import { cleanupStaleShellReleaseUploads } from './shell-releases-cleanup';
import { cleanupExpiredEditorPreviewLinks } from './preview-links-cleanup';
import { failStuckBuilds } from './builds-watchdog';
import { processRepackJob } from './repack-job';
import { loadRepackJobConfig } from './repack-config';

export const QUEUE_NAME = 'mobilio';
// A separate queue from the one above, not just another job name on it — BullMQ's
// `concurrency` option is per-Worker (effectively per-queue), not per-job-name, so
// REPACK_CONCURRENCY needs its own queue to tune independently of the lightweight
// cleanup/ping jobs above. Must match apps/api's QueueService.REPACK_QUEUE_NAME exactly
// (same duplication precedent as QUEUE_NAME itself, independently defined in both
// apps/worker and apps/api rather than shared from a package).
export const REPACK_QUEUE_NAME = 'mobilio-repack';
export const REPACK_JOB_NAME = 'repack';
export const DRAFTS_CLEANUP_JOB_NAME = 'cleanup-expired-drafts';
const DRAFTS_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const PREVIEW_LINKS_CLEANUP_JOB_NAME = 'cleanup-expired-editor-preview-links';
const PREVIEW_LINKS_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const BUILDS_WATCHDOG_JOB_NAME = 'fail-stuck-builds';
const BUILDS_WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

const logger = pino();

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const { db } = createDb(process.env.DATABASE_URL ?? 'postgres://mobilio_app:mobilio_app_pw@localhost:5433/mobilio');
const storage = createObjectStorageFromEnv();

const queue = new Queue(QUEUE_NAME, { connection });

// upsertJobScheduler is idempotent — safe to call on every worker start (including after
// a restart) without risking duplicate recurring jobs, unlike a plain setInterval which
// would need its own cross-process dedup story.
queue
  .upsertJobScheduler(DRAFTS_CLEANUP_JOB_NAME, { every: DRAFTS_CLEANUP_INTERVAL_MS }, { name: DRAFTS_CLEANUP_JOB_NAME })
  .then(() => logger.info({ intervalMs: DRAFTS_CLEANUP_INTERVAL_MS }, 'drafts cleanup scheduler registered'))
  .catch((error: unknown) => logger.error({ err: error }, 'failed to register drafts cleanup scheduler'));

queue
  .upsertJobScheduler(BUILDS_WATCHDOG_JOB_NAME, { every: BUILDS_WATCHDOG_INTERVAL_MS }, { name: BUILDS_WATCHDOG_JOB_NAME })
  .then(() => logger.info({ intervalMs: BUILDS_WATCHDOG_INTERVAL_MS }, 'builds watchdog scheduler registered'))
  .catch((error: unknown) => logger.error({ err: error }, 'failed to register builds watchdog scheduler'));

queue
  .upsertJobScheduler(
    PREVIEW_LINKS_CLEANUP_JOB_NAME,
    { every: PREVIEW_LINKS_CLEANUP_INTERVAL_MS },
    { name: PREVIEW_LINKS_CLEANUP_JOB_NAME },
  )
  .then(() => logger.info({ intervalMs: PREVIEW_LINKS_CLEANUP_INTERVAL_MS }, 'preview links cleanup scheduler registered'))
  .catch((error: unknown) => logger.error({ err: error }, 'failed to register preview links cleanup scheduler'));

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    if (job.name === 'ping') {
      const result = processPingJob(job.data as PingJobData);
      logger.info({ jobId: job.id, requestId: (job.data as PingJobData).requestId, result }, 'ping job processed');
      return result;
    }
    if (job.name === DRAFTS_CLEANUP_JOB_NAME) {
      const result = await cleanupExpiredDrafts(db, storage);
      logger.info({ jobId: job.id, ...result }, 'drafts cleanup job processed');
      // Rides along on this existing hourly scheduler rather than its own — a day's
      // staleness threshold has no need for a dedicated interval, and this is already
      // the "sweep stale storage objects" job. See shell-releases-cleanup.ts's own doc
      // comment for what it's cleaning up and why.
      const shellReleaseUploadsResult = await cleanupStaleShellReleaseUploads(storage);
      logger.info({ jobId: job.id, ...shellReleaseUploadsResult }, 'stale shell-release uploads cleanup processed');
      return result;
    }
    if (job.name === BUILDS_WATCHDOG_JOB_NAME) {
      const result = await failStuckBuilds(db);
      logger.info({ jobId: job.id, ...result }, 'builds watchdog job processed');
      return result;
    }
    if (job.name === PREVIEW_LINKS_CLEANUP_JOB_NAME) {
      const result = await cleanupExpiredEditorPreviewLinks(db);
      logger.info({ jobId: job.id, ...result }, 'preview links cleanup job processed');
      return result;
    }
    logger.warn({ jobId: job.id, jobName: job.name }, 'unknown job name, ignoring');
    return null;
  },
  { connection },
);

worker.on('error', (error) => {
  logger.error({ err: error }, 'worker error');
});

logger.info({ queue: QUEUE_NAME }, 'worker listening');

// Off by default — see apps/worker/.env.example's own framing of ASC_*/SIGNING_P12_*/
// RCODESIGN_* as "not required for anything this worker does today". Only once
// REPACK_ENABLED=true does any of that become required, and only then does this
// process even attempt to construct a second, separate Worker/Queue pair for repack
// jobs specifically — a dev/CI environment that never sets it is completely unaffected,
// not just left with an idle queue.
if (process.env.REPACK_ENABLED === 'true') {
  const repackJobConfig = loadRepackJobConfig();
  const repackConcurrency = Number(process.env.REPACK_CONCURRENCY ?? '1');
  // No sibling Queue instance needed here (unlike QUEUE_NAME above) — that one exists
  // only to register recurring job schedulers via upsertJobScheduler; the repack queue
  // has no recurring job, only one-off jobs apps/api enqueues, so a Worker alone is
  // enough to consume them.
  const repackWorker = new Worker(
    REPACK_QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== REPACK_JOB_NAME) {
        logger.warn({ jobId: job.id, jobName: job.name }, 'unknown repack-queue job name, ignoring');
        return null;
      }
      const { buildId } = job.data as { buildId: string };
      logger.info({ jobId: job.id, buildId }, 'repack job starting');
      await processRepackJob(db, storage, buildId, repackJobConfig);
      logger.info({ jobId: job.id, buildId }, 'repack job finished');
      return { buildId };
    },
    { connection, concurrency: repackConcurrency },
  );
  repackWorker.on('error', (error) => {
    logger.error({ err: error }, 'repack worker error');
  });
  repackWorker.on('failed', (job, error) => {
    // processRepackJob already records the failure on the build row itself — this is
    // just so a repack crash is visible in worker logs/Sentry the same way every other
    // job's failure is, not a second place that needs to agree with the DB.
    logger.error({ jobId: job?.id, buildId: (job?.data as { buildId?: string } | undefined)?.buildId, err: error }, 'repack job failed');
  });
  logger.info({ queue: REPACK_QUEUE_NAME, concurrency: repackConcurrency }, 'repack worker listening');
} else {
  logger.info('REPACK_ENABLED is not "true" — repack jobs are disabled on this worker');
}
