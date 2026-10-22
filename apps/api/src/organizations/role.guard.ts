import { CanActivate, ForbiddenException, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator.js';
import type { OrgRole } from './organizations.service.js';
import './organizations.types.js';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<OrgRole[]>(ROLES_KEY, context.getHandler());
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const role = request.membership?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient role for this action' });
    }
    return true;
  }
}
