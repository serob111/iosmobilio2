import { Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { QueueService } from './queue.service.js';

@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post('ping')
  async ping(@Req() req: Request & { id?: string }): Promise<{ jobId: string | undefined; requestId?: string }> {
    const result = await this.queueService.enqueuePing(req.id);
    return { ...result, requestId: req.id };
  }
}
