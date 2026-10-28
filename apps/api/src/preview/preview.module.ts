import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { ProjectPreviewLinkController, DraftPreviewLinkController } from './preview-link.controller.js';
import { PreviewController } from './preview.controller.js';
import { PreviewLinkService } from './preview-link.service.js';
import { PreviewRateLimitService } from './preview-rate-limit.js';

@Module({
  imports: [OrganizationsModule, ProjectsModule, DraftsModule],
  controllers: [ProjectPreviewLinkController, DraftPreviewLinkController, PreviewController],
  providers: [PreviewLinkService, PreviewRateLimitService],
})
export class PreviewModule {}
