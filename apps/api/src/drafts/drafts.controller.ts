import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ObjectNotFoundError } from '@mobilio/storage';
import { Public } from '../auth/public.decorator.js';
import { ICON_UPLOAD_LIMITS } from '../common/upload-limits.js';
import { DraftGuard } from './draft.guard.js';
import { DraftRateLimitService } from './draft-rate-limit.js';
import { getClientRateLimitKey } from '../common/rate-limit-key.js';
import { DraftsService } from './drafts.service.js';
import { setDraftCookie } from './draft-token.js';
import { requireUrl } from './validation.js';
import './draft.types.js';

@Controller('drafts')
export class DraftsController {
  private readonly logger = new Logger(DraftsController.name);

  constructor(
    private readonly draftsService: DraftsService,
    private readonly rateLimit: DraftRateLimitService,
  ) {}

  @Post()
  @Public()
  async create(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const allowed = await this.rateLimit.checkAndIncrement(getClientRateLimitKey(request));
    if (!allowed) {
      throw new HttpException({ message: 'Слишком много запросов. Попробуйте позже.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const url = requireUrl((body as Record<string, unknown> | null)?.url);
    const { rawToken } = await this.draftsService.createDraft(url);
    setDraftCookie(response, rawToken);
    return { ok: true };
  }

  @Get('me')
  @Public()
  @UseGuards(DraftGuard)
  getMe(@Req() request: Request) {
    return request.draft;
  }

  @Put('me')
  @Public()
  @UseGuards(DraftGuard)
  async update(@Req() request: Request, @Body() body: unknown) {
    return this.draftsService.updateDraft(request.draftTokenHash!, request.draft!.id, body);
  }

  @Post('me/icon')
  @Public()
  @UseGuards(DraftGuard)
  @UseInterceptors(FileInterceptor('icon', { limits: ICON_UPLOAD_LIMITS }))
  async uploadIcon(@Req() request: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Прикрепите файл иконки' });
    }
    await this.draftsService.uploadIcon(request.draft!.id, file);
    return { ok: true };
  }

  @Get('me/icon')
  @Public()
  @UseGuards(DraftGuard)
  async getIcon(@Req() request: Request, @Res() response: Response) {
    let stream;
    try {
      stream = await this.draftsService.getIconStream(request.draft!.id);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new NotFoundException({ code: 'ICON_NOT_FOUND', message: 'Icon not found' });
      }
      throw error;
    }
    response.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    try {
      await pipeline(stream, response);
    } catch (error) {
      // pipeline() always destroys both ends on failure — this only decides how to
      // *report* it: if nothing has been sent yet, the usual exception filter can still
      // produce a normal JSON 500; once bytes are already flowing, the response is
      // already underway and can't be rewritten into an error body, so just log and let
      // the (already-destroyed) connection drop.
      if (response.headersSent) {
        this.logger.error({ err: error }, 'Icon stream failed after headers were sent');
        return;
      }
      throw error;
    }
  }
}
