import { Controller, Post, Req, UseGuards } from '@nestjs/common';
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

  @Post()
  @UseGuards(OrgGuard, ProjectGuard)
  async create(@Req() request: Request) {
    const { orgId, userId } = request.tenant!;
    return this.previewLinkService.createForProject(orgId, userId, request.project!.id);
  }
}

@Controller('drafts/me/preview-link')
export class DraftPreviewLinkController {
  constructor(private readonly previewLinkService: PreviewLinkService) {}

  @Post()
  @Public()
  @UseGuards(DraftGuard)
  async create(@Req() request: Request) {
    return this.previewLinkService.createForDraft(request.draftTokenHash!, request.draft!.id, request.draft!.expiresAt);
  }
}
