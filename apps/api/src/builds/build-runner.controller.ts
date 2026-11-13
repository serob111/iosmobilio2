import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { BuildRunnerGuard } from './build-runner.guard.js';
import { BuildsService } from './builds.service.js';
import { requireNumber, requireString } from './validation.js';
import './build.types.js';

/**
 * The build runner's own callbacks — GitHub Actions today, a template-repack step
 * later. Deliberately NOT nested under /orgs/:orgId/projects/:projectId: the runner
 * authenticates with the build's own bearer token (BuildRunnerGuard), not an org
 * session, so there's no org/project id to put in the path at all.
 */
@Controller('builds')
export class BuildRunnerController {
  constructor(private readonly buildsService: BuildsService) {}

  @Post(':id/start')
  @Public()
  @UseGuards(BuildRunnerGuard)
  async start(@Req() request: Request, @Body() body: unknown) {
    const record = body as Record<string, unknown> | null;
    const runId = requireNumber(record?.runId, 'runId');
    const runUrl = requireString(record?.runUrl, 'runUrl');
    return this.buildsService.startBuild(request.buildTokenHash!, runId, runUrl);
  }

  @Get(':id/config')
  @Public()
  @UseGuards(BuildRunnerGuard)
  async config(@Req() request: Request) {
    return this.buildsService.getBuildConfig(request.buildTokenHash!);
  }

  @Get(':id/icon')
  @Public()
  @UseGuards(BuildRunnerGuard)
  async icon(@Req() request: Request, @Res() response: Response) {
    const stream = await this.buildsService.getIconStream(request.buildTokenHash!);
    response.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    stream.pipe(response);
  }

  @Post(':id/ipa')
  @Public()
  @UseGuards(BuildRunnerGuard)
  async uploadIpa(@Req() request: Request) {
    const build = request.build!;
    await this.buildsService.uploadIpa(
      request.buildTokenHash!,
      { id: build.id, orgId: build.orgId, projectId: build.projectId, status: build.status },
      request,
    );
    return { ok: true };
  }

  @Post(':id/fail')
  @Public()
  @UseGuards(BuildRunnerGuard)
  async fail(@Req() request: Request, @Body() body: unknown) {
    const record = body as Record<string, unknown> | null;
    const error = requireString(record?.error, 'error');
    await this.buildsService.failBuild(request.buildTokenHash!, error);
    return { ok: true };
  }
}
