import { Controller, Get, HttpException, HttpStatus, Param, Post, Redirect, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OrgGuard } from '../organizations/org.guard.js';
import { ProjectGuard } from '../projects/project.guard.js';
import { Public } from '../auth/public.decorator.js';
import { getClientRateLimitKey } from '../common/rate-limit-key.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';
import '../projects/project.types.js';
import { BuildRateLimitService } from './build-rate-limit.js';
import { InstallRateLimitService } from './install-rate-limit.js';
import { BuildsService } from './builds.service.js';

@Controller('orgs/:orgId/projects/:projectId/builds')
export class BuildsController {
  constructor(
    private readonly buildsService: BuildsService,
    private readonly rateLimit: BuildRateLimitService,
    private readonly installRateLimit: InstallRateLimitService,
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

  /**
   * Public, unauthenticated — what an itms-services://?action=download-manifest&url=...
   * link (shown once the build is done) actually points at. No session/cookies on the
   * device that fetches this, so OrgGuard/ProjectGuard don't apply; the three ids in
   * the path itself are the only "proof" presented, same tradeoff as every other public
   * capability-style link in this app, just three chained UUIDs deep instead of one slug.
   *
   * Content-Type is set via @Res({passthrough: true}) rather than @Header() — @Header()
   * applies its header unconditionally, before the handler body even runs, which stuck
   * even on the *error* path once getInstallManifest() throws: the global exception
   * filter's response.json() only sets Content-Type when none is already present (Express's
   * own behavior), so the 404 body ended up sent as valid JSON bytes under an
   * application/xml Content-Type — breaking any client (supertest included) that parses
   * the body based on that header. Found by writing a real integration test, not by
   * reasoning about the framework. Setting it only on the success path here means a
   * thrown exception never reaches this line at all, so the error response keeps
   * whatever Content-Type the global filter actually sends.
   */
  @Get(':buildId/manifest.plist')
  @Public()
  async getInstallManifest(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('buildId') buildId: string,
  ) {
    const allowed = await this.installRateLimit.checkAndIncrement(getClientRateLimitKey(request));
    if (!allowed) {
      throw new HttpException({ message: 'Слишком много запросов. Попробуйте позже.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const manifest = await this.buildsService.getInstallManifest(orgId, projectId, buildId);
    response.set('Content-Type', 'application/xml');
    return manifest;
  }

  /** Public, unauthenticated — the stable url manifest.plist's own url points at; 302s to a freshly signed S3 url generated on every request. */
  @Get(':buildId/install.ipa')
  @Public()
  @Redirect()
  async getInstallIpa(@Req() request: Request, @Param('orgId') orgId: string, @Param('projectId') projectId: string, @Param('buildId') buildId: string) {
    const allowed = await this.installRateLimit.checkAndIncrement(getClientRateLimitKey(request));
    if (!allowed) {
      throw new HttpException({ message: 'Слишком много запросов. Попробуйте позже.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const url = await this.buildsService.getInstallIpaUrl(orgId, projectId, buildId);
    return { url };
  }
}
