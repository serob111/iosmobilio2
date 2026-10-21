import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizationsService } from './organizations.service.js';
import '../auth/auth.types.js';

@Controller()
export class MeController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('me')
  async getMe(@Req() request: Request) {
    const user = request.user!;
    const organizations = await this.organizationsService.getUserOrganizations(user.id);
    return { user, organizations };
  }
}
