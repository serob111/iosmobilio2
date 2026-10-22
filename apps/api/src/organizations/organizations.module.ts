import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { MeController } from './me.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { OrgGuard } from './org.guard.js';
import { RoleGuard } from './role.guard.js';

@Module({
  controllers: [MeController, OrganizationsController, InvitationsController],
  providers: [OrganizationsService, OrgGuard, RoleGuard],
  // OrgGuard is exported so other modules whose routes nest under /orgs/:orgId (like
  // ProjectsModule) can reuse it via @UseGuards(OrgGuard) instead of re-implementing
  // the same membership check.
  exports: [OrganizationsService, OrgGuard],
})
export class OrganizationsModule {}
