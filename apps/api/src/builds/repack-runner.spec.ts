import { RepackRunner } from './repack-runner.js';
import type { QueueService } from '../queue/queue.service.js';

describe('RepackRunner', () => {
  it('enqueues a repack job with the build id, ignoring token/baseUrl', async () => {
    const enqueueRepack = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const runner = new RepackRunner({ enqueueRepack } as unknown as QueueService);

    await runner.dispatch({ id: 'build-123', token: 'raw-token', baseUrl: 'https://api.example.com' });

    expect(enqueueRepack).toHaveBeenCalledTimes(1);
    expect(enqueueRepack).toHaveBeenCalledWith('build-123');
  });

  it('propagates a failure to enqueue', async () => {
    const enqueueRepack = vi.fn().mockRejectedValue(new Error('redis unreachable'));
    const runner = new RepackRunner({ enqueueRepack } as unknown as QueueService);

    await expect(runner.dispatch({ id: 'build-123', token: 't', baseUrl: 'https://api.example.com' })).rejects.toThrow('redis unreachable');
  });
});
