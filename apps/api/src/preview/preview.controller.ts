import { Controller, Get, HttpException, HttpStatus, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { getClientRateLimitKey } from '../common/rate-limit-key.js';
import { PreviewLinkService } from './preview-link.service.js';
import { PreviewRateLimitService } from './preview-rate-limit.js';

@Controller('preview')
export class PreviewController {
  constructor(
    private readonly previewLinkService: PreviewLinkService,
    private readonly rateLimit: PreviewRateLimitService,
  ) {}

  @Get(':slug')
  @Public()
  async getBySlug(@Req() request: Request, @Param('slug') slug: string) {
    const allowed = await this.rateLimit.checkAndIncrement(getClientRateLimitKey(request));
    if (!allowed) {
      throw new HttpException({ message: 'Слишком много запросов. Попробуйте позже.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.previewLinkService.getPreviewDto(slug);
  }
}
