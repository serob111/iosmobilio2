import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { processPingJob, type PingJobData } from './processors';

export const QUEUE_NAME = 'mobilio';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const worker = new Worker<PingJobData>(
  QUEUE_NAME,
  async (job: Job<PingJobData>) => {
    if (job.name === 'ping') {
      const result = processPingJob(job.data);
      console.log(`[worker] ping job ${job.id} processed`, result);
      return result;
    }
    console.warn(`[worker] unknown job name "${job.name}", ignoring`);
    return null;
  },
  { connection },
);

worker.on('error', (error) => {
  console.error('[worker] error', error);
});

console.log(`Worker listening on queue "${QUEUE_NAME}"`);
