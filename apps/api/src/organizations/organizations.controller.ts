import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OrgGuard } from './org.guard.js';
import { RoleGuard } from './role.guard.js';
import { Roles } from './roles.decorator.js';
import { OrganizationsService } from './organizations.service.js';
import { requireString, requireRole } from './validation.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';

@Controller('orgs')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const name = requireString((body as Record<string, unknown> | null)?.name, 'name');
    return this.organizationsService.createOrganization(request.user!.id, name);
  }

  @Get(':orgId')
  @UseGuards(OrgGuard)
  async getOne(@Req() request: Request) {
    return this.organizationsService.getOrganization(request.tenant!.orgId, request.tenant!.userId);
  }

  @Post(':orgId/invitations')
  @UseGuards(OrgGuard, RoleGuard)
  @Roles('owner', 'admin')
  async invite(@Req() request: Request, @Body() body: unknown) {
    const record = body as Record<string, unknown> | null;
    const email = requireString(record?.email, 'email');
    const role = requireRole(record?.role);
    return this.organizationsService.inviteMember(request.tenant!.orgId, request.tenant!.userId, email, role);
  }

  @Delete(':orgId/invitations/:invitationId')
  @UseGuards(OrgGuard, RoleGuard)
  @Roles('owner', 'admin')
  @HttpCode(204)
  async revokeInvitation(@Req() request: Request, @Param('invitationId') invitationId: string): Promise<void> {
    await this.organizationsService.revokeInvitation(request.tenant!.orgId, request.tenant!.userId, invitationId);
  }

  @Patch(':orgId/members/:userId')
  @UseGuards(OrgGuard, RoleGuard)
  @Roles('owner', 'admin')
  async changeRole(@Req() request: Request, @Param('userId') targetUserId: string, @Body() body: unknown) {
    const role = requireRole((body as Record<string, unknown> | null)?.role);
    await this.organizationsService.changeRole(request.tenant!.orgId, request.tenant!.userId, targetUserId, role);
    return { status: 'ok' };
  }

  @Delete(':orgId/members/:userId')
  @UseGuards(OrgGuard, RoleGuard)
  @Roles('owner', 'admin')
  @HttpCode(204)
  async removeMember(@Req() request: Request, @Param('userId') targetUserId: string): Promise<void> {
    await this.organizationsService.removeMember(request.tenant!.orgId, request.tenant!.userId, targetUserId);
  }
}
