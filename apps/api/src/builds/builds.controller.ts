import { Controller, Get, HttpException, HttpStatus, Param, Post, Redirect, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OrgGuard } from '../organizations/org.guard.js';
import { ProjectGuard } from '../projects/project.guard.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';
import '../projects/project.types.js';
import { BuildRateLimitService } from './build-rate-limit.js';
import { BuildsService } from './builds.service.js';

@Controller('orgs/:orgId/projects/:projectId/builds')
export class BuildsController {
  constructor(
    private readonly buildsService: BuildsService,
    private readonly rateLimit: BuildRateLimitService,
  ) {}

  @Post()
  @UseGuards(OrgGuard, ProjectGuard)
  async create(@Req() request: Request) {
    const { orgId, userId } = request.tenant!;
    const allowed = await this.rateLimit.checkAndIncrement(orgId);
    if (!allowed) {
      throw new HttpException(
        { message: 'Слишком много сборок за последний час. Попробуйте позже.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const apiPublicUrl = process.env.API_PUBLIC_URL ?? '';
    return this.buildsService.createBuild(orgId, userId, request.project!.id, apiPublicUrl);
  }

  @Get()
  @UseGuards(OrgGuard, ProjectGuard)
  async list(@Req() request: Request) {
    const { orgId, userId } = request.tenant!;
    return this.buildsService.listBuilds(orgId, userId, request.project!.id);
  }

  @Get(':buildId')
  @UseGuards(OrgGuard, ProjectGuard)
  async getOne(@Req() request: Request, @Param('buildId') buildId: string) {
    const { orgId, userId } = request.tenant!;
    return this.buildsService.getBuild(orgId, userId, request.project!.id, buildId);
  }

  @Get(':buildId/ipa')
  @UseGuards(OrgGuard, ProjectGuard)
  @Redirect()
  async getIpa(@Req() request: Request, @Param('buildId') buildId: string) {
    const { orgId, userId } = request.tenant!;
    const url = await this.buildsService.getIpaUrl(orgId, userId, request.project!.id, buildId);
    return { url };
  }
}
