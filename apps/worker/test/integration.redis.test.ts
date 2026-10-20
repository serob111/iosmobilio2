import { describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

// Only runs when a real Redis is reachable (CI sets REDIS_URL from its services:
// container — see .github/workflows/ci.yml). Locally this just skips, since plain
// `npm test` shouldn't require live infrastructure.
const hasRedis = Boolean(process.env.REDIS_URL);

describe.skipIf(!hasRedis)('BullMQ (live redis)', () => {
  it('processes a real ping job end-to-end', async () => {
    const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const queueName = `mobilio-test-${Date.now()}`;
    const queue = new Queue(queueName, { connection });

    const worker = new Worker(
      queueName,
      async (job) => ({ pong: true, requestId: job.data.requestId as string | undefined }),
      { connection },
    );

    try {
      const completed = new Promise<unknown>((resolve, reject) => {
        worker.on('completed', (_job, result) => resolve(result));
        worker.on('failed', (_job, err) => reject(err));
      });

      await queue.add('ping', { requestId: 'integration-test' });
      const result = await completed;

      expect(result).toEqual({ pong: true, requestId: 'integration-test' });
    } finally {
      await worker.close();
      await queue.close();
      connection.disconnect();
    }
  }, 15_000);
});
