import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizationsService } from './organizations.service.js';
import { requireString } from './validation.js';
import '../auth/auth.types.js';

/**
 * Deliberately NOT under /orgs/:orgId — accepting an invitation is how a user BECOMES a
 * member, so OrgGuard (which requires existing membership) doesn't apply here. Identity
 * comes entirely from the token (see OrganizationsService.acceptInvitation). Still
 * requires a session (the global AuthGuard, not opted out via @Public()) — the
 * accepting user must be signed in as themselves.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post('accept')
  async accept(@Req() request: Request, @Body() body: unknown) {
    const token = requireString((body as Record<string, unknown> | null)?.token, 'token');
    const user = request.user!;
    return this.organizationsService.acceptInvitation(user.id, user.email, token);
  }
}
