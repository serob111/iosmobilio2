import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Redirect,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { OrgGuard } from '../organizations/org.guard.js';
import { ProjectGuard } from './project.guard.js';
import { ProjectsService } from './projects.service.js';
import { requireUrl } from './validation.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';
import './project.types.js';

@Controller('orgs/:orgId/projects')
export class ProjectsController {
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
  @UseInterceptors(FileInterceptor('icon'))
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
  @Redirect()
  async getIcon(@Req() request: Request, @Param('projectId') projectId: string) {
    const url = await this.projectsService.getIconUrl(request.tenant!.orgId, projectId);
    return { url };
  }
}
