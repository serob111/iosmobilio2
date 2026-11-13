import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
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
import { ICON_UPLOAD_LIMITS } from '../common/upload-limits.js';
import { OrgGuard } from '../organizations/org.guard.js';
import { ProjectGuard } from './project.guard.js';
import { ProjectsService } from './projects.service.js';
import { requireUrl } from './validation.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';
import './project.types.js';

@Controller('orgs/:orgId/projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @UseGuards(OrgGuard)
  async create(@Req() request: Request, @Body() body: unknown) {
    const url = requireUrl((body as Record<string, unknown> | null)?.url);
    return this.projectsService.createProject(request.tenant!.orgId, request.tenant!.userId, url);
  }

  @Get()
  @UseGuards(OrgGuard)
  async list(@Req() request: Request) {
    return this.projectsService.listProjects(request.tenant!.orgId, request.tenant!.userId);
  }

  @Get(':projectId')
  @UseGuards(OrgGuard, ProjectGuard)
  getOne(@Req() request: Request) {
    return request.project;
  }

  @Put(':projectId')
  @UseGuards(OrgGuard, ProjectGuard)
  async update(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.projectsService.updateProject(
      request.tenant!.orgId,
      request.tenant!.userId,
      projectId,
      body,
    );
  }

  @Post(':projectId/icon')
  @UseGuards(OrgGuard, ProjectGuard)
  @UseInterceptors(FileInterceptor('icon', { limits: ICON_UPLOAD_LIMITS }))
  async uploadIcon(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Прикрепите файл иконки',
      });
    }
    await this.projectsService.uploadIcon(request.tenant!.orgId, projectId, file);
    return { ok: true };
  }

  @Get(':projectId/icon')
  @UseGuards(OrgGuard, ProjectGuard)
  async getIcon(
    @Req() request: Request,
    @Res() response: Response,
    @Param('projectId') projectId: string,
  ) {
    let stream;
    try {
      stream = await this.projectsService.getIconStream(request.tenant!.orgId, projectId);
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
