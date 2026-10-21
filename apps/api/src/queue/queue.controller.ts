import { Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { QueueService } from './queue.service.js';

@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Public()
  @Post('ping')
  async ping(@Req() req: Request & { id?: string }): Promise<{ jobId: string | undefined; requestId?: string }> {
    const result = await this.queueService.enqueuePing(req.id);
    return { ...result, requestId: req.id };
  }
}
