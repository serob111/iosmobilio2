import { BadRequestException, Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
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
      const { uploadId } = await this.shellReleasesService.uploadIpa(version, request);
      return { ok: true, uploadId };
    } catch (error) {
      if (error instanceof IpaValidationError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  @Post()
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const record = body as Record<string, unknown> | null;
    const version = requireString(record?.version, 'version');
    const sha256 = requireString(record?.sha256, 'sha256');
    // Optional: only actually needed to register a brand-new version (to find the temp
    // upload to verify+promote) — see ShellReleasesService.register's own doc comment.
    // An idempotent re-registration of an already-registered version never reaches that
    // code path, so it shouldn't have to carry an uploadId it has no use for.
    const uploadId = typeof record?.uploadId === 'string' ? record.uploadId : undefined;
    const manifest = record?.manifest;
    if (!manifest || typeof manifest !== 'object') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'manifest is required' });
    }
    const result = await this.shellReleasesService.register(version, manifest as Record<string, unknown>, sha256, uploadId);
    // register() is idempotent on a matching re-registration — 200 for "already there,
    // unchanged" vs the normal POST default of 201 for "just created" is what actually
    // lets a caller tell those two outcomes apart without parsing the body.
    response.status(result.status === 'created' ? 201 : 200);
    return result.release;
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
