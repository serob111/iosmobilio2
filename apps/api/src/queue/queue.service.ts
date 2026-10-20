import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUE_NAME = 'mobilio';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  private readonly queue = new Queue(QUEUE_NAME, { connection: this.connection });

  /** Enqueues the worker's "ping" job, threading the request's correlation id through job.data. */
  async enqueuePing(requestId?: string): Promise<{ jobId: string | undefined }> {
    const job = await this.queue.add('ping', { requestId });
    return { jobId: job.id };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
