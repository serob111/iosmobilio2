import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { OrgGuard } from '../organizations/org.guard.js';
import { ProjectGuard } from '../projects/project.guard.js';
import { DraftGuard } from '../drafts/draft.guard.js';
import { PreviewLinkService } from './preview-link.service.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';
import '../projects/project.types.js';
import '../drafts/draft.types.js';

@Controller('orgs/:orgId/projects/:projectId/preview-link')
export class ProjectPreviewLinkController {
  constructor(private readonly previewLinkService: PreviewLinkService) {}

  /** The share link's own live-editing iframe link — always fresh, never revokes anything. */
  @Post('editor')
  @UseGuards(OrgGuard, ProjectGuard)
  async createEditor(@Req() request: Request) {
    const { orgId, userId } = request.tenant!;
    return this.previewLinkService.createEditorLinkForProject(orgId, userId, request.project!.id);
  }

  /** The current active share link, if any — 404 (PREVIEW_LINK_NOT_FOUND) otherwise. */
  @Get()
  @UseGuards(OrgGuard, ProjectGuard)
  async getActive(@Req() request: Request) {
    const { orgId, userId } = request.tenant!;
    return this.previewLinkService.getActiveShareLinkForProject(orgId, userId, request.project!.id);
  }

  /** Creates a share link only if none is currently active; returns the existing one otherwise. */
  @Post()
  @UseGuards(OrgGuard, ProjectGuard)
  async create(@Req() request: Request) {
    const { orgId, userId } = request.tenant!;
    return this.previewLinkService.createShareLinkForProject(orgId, userId, request.project!.id);
  }

  /** Explicitly revokes whatever share link is active and creates a brand new one. */
  @Post('regenerate')
  @UseGuards(OrgGuard, ProjectGuard)
  async regenerate(@Req() request: Request) {
    const { orgId, userId } = request.tenant!;
    return this.previewLinkService.regenerateShareLinkForProject(orgId, userId, request.project!.id);
  }
}

@Controller('drafts/me/preview-link')
export class DraftPreviewLinkController {
  constructor(private readonly previewLinkService: PreviewLinkService) {}

  @Post('editor')
  @Public()
  @UseGuards(DraftGuard)
  async createEditor(@Req() request: Request) {
    return this.previewLinkService.createEditorLinkForDraft(request.draftTokenHash!, request.draft!.id);
  }

  @Get()
  @Public()
  @UseGuards(DraftGuard)
  async getActive(@Req() request: Request) {
    return this.previewLinkService.getActiveShareLinkForDraft(request.draftTokenHash!, request.draft!.id);
  }

  @Post()
  @Public()
  @UseGuards(DraftGuard)
  async create(@Req() request: Request) {
    return this.previewLinkService.createShareLinkForDraft(request.draftTokenHash!, request.draft!.id, request.draft!.expiresAt);
  }

  @Post('regenerate')
  @Public()
  @UseGuards(DraftGuard)
  async regenerate(@Req() request: Request) {
    return this.previewLinkService.regenerateShareLinkForDraft(
      request.draftTokenHash!,
      request.draft!.id,
      request.draft!.expiresAt,
    );
  }
}
