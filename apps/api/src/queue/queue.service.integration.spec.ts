import { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { QueueService, REPACK_QUEUE_NAME } from './queue.service.js';

// Only runs when a real Redis is reachable — see apps/worker/test/integration.redis.test.ts
// for the same gating convention. Locally this just skips; in CI, REQUIRE_LIVE_SERVICES=true
// turns a missing REDIS_URL into a hard failure instead of a silent skip.
const hasRedis = Boolean(process.env.REDIS_URL);
if (!hasRedis && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but REDIS_URL is not set');
}

describe.skipIf(!hasRedis)('QueueService.enqueueRepack (live redis)', () => {
  it('adds a real "repack" job, with the build id as its data, to the dedicated repack queue — not the shared ping/cleanup queue', async () => {
    const service = new QueueService();
    const inspectQueue = new Queue(REPACK_QUEUE_NAME, { connection: { url: process.env.REDIS_URL! } });

    try {
      const { jobId } = await service.enqueueRepack('build-123');
      expect(jobId).toBeTruthy();

      const job = await inspectQueue.getJob(jobId!);
      expect(job).not.toBeNull();
      expect(job!.name).toBe('repack');
      expect(job!.data).toEqual({ buildId: 'build-123' });
    } finally {
      await service.onModuleDestroy();
      await inspectQueue.close();
    }
  }, 15_000);
});
