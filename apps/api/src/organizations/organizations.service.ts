import { Injectable } from '@nestjs/common';
import { runInTenantContext, getTenantDb, schema } from '@mobilio/db';
import { slugify } from '@mobilio/config';
import { uuidv7 } from 'uuidv7';
import { DbService } from '../db/db.service.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Called once, right after Better Auth creates a new user (see AuthModule's
   * databaseHooks). Magic-link signups never collect a name, so `name` is routinely
   * empty — email is the fallback, not an edge case to special-case away.
   */
  async createPersonalOrganization(userId: string, name: string, email: string): Promise<{ orgId: string }> {
    const orgId = uuidv7();
    const displayName = name.trim() || email.split('@')[0] || 'Personal';
    const base = slugify(displayName) || 'personal';
    const slug = `${base}-${orgId.slice(0, 8)}`;

    await runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      await tx.insert(schema.organizations).values({ id: orgId, name: `${displayName}'s workspace`, slug });
      await tx.insert(schema.memberships).values({ userId, orgId, role: 'owner' });
    });

    return { orgId };
  }
}
