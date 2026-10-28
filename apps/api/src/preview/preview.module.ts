import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { ProjectPreviewLinkController, DraftPreviewLinkController } from './preview-link.controller.js';
import { PreviewController } from './preview.controller.js';
import { PreviewLinkService } from './preview-link.service.js';
import { PreviewRateLimitService } from './preview-rate-limit.js';
import { ProxyRateLimitService } from './proxy/proxy-rate-limit.js';
import { ProxyCacheService } from './proxy/proxy-cache.js';

@Module({
  imports: [OrganizationsModule, ProjectsModule, DraftsModule],
  controllers: [ProjectPreviewLinkController, DraftPreviewLinkController, PreviewController],
  // ProxyRateLimitService/ProxyCacheService/PreviewLinkService are not consumed by any
  // Nest controller — create-app.ts pulls them out via app.get(...) to construct the
  // preview proxy's own plain Express middleware (proxy-middleware.ts), the same pattern
  // already used there for Better Auth's handler. Still declared here as providers so
  // Nest's DI container is what actually constructs them (and tears them down via their
  // own OnModuleDestroy hooks on app shutdown).
  providers: [PreviewLinkService, PreviewRateLimitService, ProxyRateLimitService, ProxyCacheService],
  exports: [PreviewLinkService, ProxyRateLimitService, ProxyCacheService],
})
export class PreviewModule {}
