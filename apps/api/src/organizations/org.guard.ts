import { CanActivate, Injectable, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { runInTenantContext, getTenantDb, schema, eq } from '@mobilio/db';
import type { Request } from 'express';
import { DbService } from '../db/db.service.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';
import './organizations.types.js';

/**
 * Confirms the authenticated caller (set by AuthGuard, which must run first) belongs
 * to the org named by the :orgId route param, and attaches request.tenant +
 * request.membership for downstream guards/handlers to use. 404s rather than 403s on
 * both "org doesn't exist" and "not a member" — deliberately indistinguishable, so this
 * endpoint can't be used to probe which org ids exist.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(private readonly dbService: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const orgId = request.params.orgId;
    const userId = request.user?.id;

    if (typeof orgId !== 'string' || !userId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found' });
    }

    const membership = await runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const [row] = await getTenantDb()
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(eq(schema.memberships.userId, userId));
      return row;
    });

    if (!membership) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found' });
    }

    request.tenant = { orgId, userId };
    request.membership = membership;
    return true;
  }
}
