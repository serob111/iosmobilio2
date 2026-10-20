import 'dotenv/config';
import './instrumentation';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { processPingJob, type PingJobData } from './processors';

export const QUEUE_NAME = 'mobilio';

const logger = pino();

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const worker = new Worker<PingJobData>(
  QUEUE_NAME,
  async (job: Job<PingJobData>) => {
    if (job.name === 'ping') {
      const result = processPingJob(job.data);
      logger.info({ jobId: job.id, requestId: job.data.requestId, result }, 'ping job processed');
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
