import 'dotenv/config';
import './instrumentation';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { createDb } from '@mobilio/db';
import { createObjectStorageFromEnv } from '@mobilio/storage';
import { processPingJob, type PingJobData } from './processors';
import { cleanupExpiredDrafts } from './drafts-cleanup';

export const QUEUE_NAME = 'mobilio';
export const DRAFTS_CLEANUP_JOB_NAME = 'cleanup-expired-drafts';
const DRAFTS_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

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
