import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { ProjectPreviewLinkController, DraftPreviewLinkController } from './preview-link.controller.js';
import { PreviewController } from './preview.controller.js';
import { PreviewLinkService } from './preview-link.service.js';
import { PreviewRateLimitService } from './preview-rate-limit.js';
import { ProxyController } from './proxy/proxy.controller.js';
import { ProxyRateLimitService } from './proxy/proxy-rate-limit.js';
import { ProxyCacheService } from './proxy/proxy-cache.js';

@Module({
  imports: [OrganizationsModule, ProjectsModule, DraftsModule],
  controllers: [ProjectPreviewLinkController, DraftPreviewLinkController, PreviewController, ProxyController],
  providers: [PreviewLinkService, PreviewRateLimitService, ProxyRateLimitService, ProxyCacheService],
})
export class PreviewModule {}
