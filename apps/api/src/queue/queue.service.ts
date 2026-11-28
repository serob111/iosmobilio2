import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUE_NAME = 'mobilio';
// A separate queue from the cleanup/ping queue above, not just a different job name on
// the same one — BullMQ's `concurrency` option is per-Worker-instance (effectively
// per-queue), not per-job-name, so giving repack jobs their own independently-tunable
// concurrency (REPACK_CONCURRENCY, see apps/worker) requires their own queue. Same
// Redis connection as QUEUE_NAME is reused below; BullMQ queues are cheap to multiplex
// over one connection.
export const REPACK_QUEUE_NAME = 'mobilio-repack';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  private readonly queue = new Queue(QUEUE_NAME, { connection: this.connection });
  private readonly repackQueue = new Queue(REPACK_QUEUE_NAME, { connection: this.connection });

  /** Enqueues the worker's "ping" job, threading the request's correlation id through job.data. */
  async enqueuePing(requestId?: string): Promise<{ jobId: string | undefined }> {
    const job = await this.queue.add('ping', { requestId });
    return { jobId: job.id };
  }

  /** Enqueues the worker's repack job for an already-created (status: 'queued') build row — the job itself owns every subsequent status transition. */
  async enqueueRepack(buildId: string): Promise<{ jobId: string | undefined }> {
    const job = await this.repackQueue.add('repack', { buildId });
    return { jobId: job.id };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.repackQueue.close();
    this.connection.disconnect();
  }
}
