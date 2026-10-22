import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectGuard } from './project.guard.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';

@Module({
  imports: [OrganizationsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectGuard],
})
export class ProjectsModule {}
