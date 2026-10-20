import { createParamDecorator, InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantIdentity } from './tenant.types.js';

/**
 * Reads the tenant identity OrgGuard attached to the request. Throws rather than
 * returning undefined if a route uses `@Tenant()` without `OrgGuard` in front of it —
 * that combination is a wiring bug, not a case callers should have to null-check.
 */
export function tenantParamFactory(_data: unknown, ctx: ExecutionContext): TenantIdentity {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.tenant) {
    throw new InternalServerErrorException('@Tenant() used on a route without OrgGuard');
  }
  return request.tenant;
}

export const Tenant = createParamDecorator(tenantParamFactory);
