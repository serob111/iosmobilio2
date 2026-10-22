import { CanActivate, Injectable, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { runInTenantContext, getTenantDb, schema, eq } from '@mobilio/db';
import type { ProjectConfig } from '@mobilio/config';
import type { Request } from 'express';
import { DbService } from '../db/db.service.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';
import './project.types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Must run after OrgGuard (reads request.tenant, which only OrgGuard sets). Confirms
 * the :projectId route param names a project that actually belongs to the org already
 * confirmed by OrgGuard, and attaches request.project for handlers to reuse without a
 * second query. 404s (not 403) on both "no such project" and "project belongs to a
 * different org" — RLS already makes the latter return zero rows, not an error, so this
 * guard can't even tell the two cases apart, which is the point.
 */
@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(private readonly dbService: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const projectId = request.params.projectId;
    const tenant = request.tenant;

    if (typeof projectId !== 'string' || !UUID_PATTERN.test(projectId) || !tenant) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    const project = await runInTenantContext(this.dbService.db, tenant, async () => {
      const [row] = await getTenantDb()
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId));
      return row;
    });

    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    request.project = {
      id: project.id,
      name: project.name,
      sourceUrl: project.sourceUrl,
      config: project.config as ProjectConfig,
      configVersion: project.configVersion,
    };
    return true;
  }
}
