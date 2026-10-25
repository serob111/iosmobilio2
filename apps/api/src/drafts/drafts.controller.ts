import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Redirect,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { DraftGuard } from './draft.guard.js';
import { DraftRateLimitService, getClientRateLimitKey } from './draft-rate-limit.js';
import { DraftsService } from './drafts.service.js';
import { setDraftCookie } from './draft-token.js';
import { requireUrl } from './validation.js';
import './draft.types.js';

@Controller('drafts')
export class DraftsController {
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
  @UseInterceptors(FileInterceptor('icon'))
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
  @Redirect()
  async getIcon(@Req() request: Request) {
    const url = await this.draftsService.getIconUrl(request.draft!.id);
    return { url };
  }
}
