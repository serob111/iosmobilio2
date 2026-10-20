import { Test } from '@nestjs/testing';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';

describe('QueueController', () => {
  it('enqueues a ping job using the request id and returns both', async () => {
    const enqueuePing = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const moduleRef = await Test.createTestingModule({
      controllers: [QueueController],
      providers: [{ provide: QueueService, useValue: { enqueuePing } }],
    }).compile();

    const controller = moduleRef.get(QueueController);
    const result = await controller.ping({ id: 'req-abc' } as never);

    expect(enqueuePing).toHaveBeenCalledWith('req-abc');
    expect(result).toEqual({ jobId: 'job-1', requestId: 'req-abc' });
  });
});
