import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectGuard } from './project.guard.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';

@Module({
  imports: [OrganizationsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectGuard],
  // ProjectGuard is exported so other modules whose routes nest under
  // /orgs/:orgId/projects/:projectId (like BuildsModule) can reuse it via
  // @UseGuards(OrgGuard, ProjectGuard) instead of re-implementing the same lookup.
  exports: [ProjectGuard],
})
export class ProjectsModule {}
