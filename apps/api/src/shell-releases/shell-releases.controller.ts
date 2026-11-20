import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { requireString } from '../builds/validation.js';
import { IpaValidationError } from '../builds/ipa-stream.js';
import { ShellReleaseAuthGuard } from './shell-release-auth.guard.js';
import { ShellReleasesService } from './shell-releases.service.js';

/**
 * Internal-only — called by .github/workflows/build-shell-base.yml, never by apps/web
 * or a user session. @Public() + ShellReleaseAuthGuard instead of the global
 * session AuthGuard (see app.module.ts).
 */
@Controller('internal/shell-releases')
@Public()
@UseGuards(ShellReleaseAuthGuard)
export class ShellReleasesController {
  constructor(private readonly shellReleasesService: ShellReleasesService) {}

  @Post(':version/ipa')
  async uploadIpa(@Param('version') version: string, @Req() request: Request) {
    try {
      await this.shellReleasesService.uploadIpa(version, request);
    } catch (error) {
      if (error instanceof IpaValidationError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
    return { ok: true };
  }

  @Post()
  async register(@Body() body: unknown) {
    const record = body as Record<string, unknown> | null;
    const version = requireString(record?.version, 'version');
    const sha256 = requireString(record?.sha256, 'sha256');
    const manifest = record?.manifest;
    if (!manifest || typeof manifest !== 'object') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'manifest is required' });
    }
    return this.shellReleasesService.register(version, manifest as Record<string, unknown>, sha256);
  }

  @Post(':version/activate')
  async activate(@Param('version') version: string) {
    return this.shellReleasesService.activate(version);
  }

  @Get()
  async list() {
    return this.shellReleasesService.list();
  }

  @Get('active')
  async active() {
    const release = await this.shellReleasesService.getActive();
    return release ?? { active: null };
  }
}
