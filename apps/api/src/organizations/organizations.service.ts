import { randomBytes, createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  runInTenantContext,
  runInUserContext,
  runInTokenLookupContext,
  getTenantDb,
  schema,
  eq,
} from '@mobilio/db';
import { slugify } from '@mobilio/config';
import { uuidv7 } from 'uuidv7';
import { DbService } from '../db/db.service.js';
import { MAIL_SENDER, type MailSender } from '../mail/mail-sender.js';

export type OrgRole = 'owner' | 'admin' | 'member';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly dbService: DbService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
  ) {}

  private async insertOrganization(
    ownerUserId: string,
    name: string,
    slugBase: string,
  ): Promise<{ orgId: string; slug: string }> {
    const orgId = uuidv7();
    const slug = `${slugify(slugBase) || 'org'}-${orgId.slice(0, 8)}`;
    await runInTenantContext(this.dbService.db, { orgId, userId: ownerUserId }, async () => {
      const tx = getTenantDb();
      await tx.insert(schema.organizations).values({ id: orgId, name, slug });
      await tx.insert(schema.memberships).values({ userId: ownerUserId, orgId, role: 'owner' });
    });
    return { orgId, slug };
  }

  /**
   * Called once, right after Better Auth creates a new user (see AuthModule's
   * databaseHooks). Magic-link signups never collect a name, so `name` is routinely
   * empty — email is the fallback, not an edge case to special-case away.
   */
  async createPersonalOrganization(userId: string, name: string, email: string): Promise<{ orgId: string }> {
    const displayName = name.trim() || email.split('@')[0] || 'Personal';
    const { orgId } = await this.insertOrganization(userId, `${displayName}'s workspace`, displayName);
    return { orgId };
  }

  /** POST /orgs — any authenticated user can create a new organization, becoming its owner. */
  async createOrganization(userId: string, name: string): Promise<{ orgId: string; slug: string }> {
    return this.insertOrganization(userId, name, name);
  }

  /** GET /me's organizations list — every org the user belongs to, with their role in each. */
  async getUserOrganizations(
    userId: string,
  ): Promise<Array<{ id: string; name: string; slug: string; role: OrgRole }>> {
    return runInUserContext(this.dbService.db, userId, () =>
      getTenantDb()
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
          role: schema.memberships.role,
        })
        .from(schema.memberships)
        .innerJoin(schema.organizations, eq(schema.memberships.orgId, schema.organizations.id))
        .where(eq(schema.memberships.userId, userId)),
    );
  }

  /** GET /orgs/:orgId — caller is already confirmed as a member by OrgGuard. */
  async getOrganization(orgId: string, userId: string) {
    return runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      const [org] = await tx.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
      const members = await tx
        .select({
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id));
      return { id: org!.id, name: org!.name, slug: org!.slug, members };
    });
  }

  async inviteMember(
    orgId: string,
    invitedByUserId: string,
    email: string,
    role: OrgRole,
  ): Promise<{ invitationId: string }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitationId = uuidv7();

    const org = await runInTenantContext(this.dbService.db, { orgId, userId: invitedByUserId }, async () => {
      const tx = getTenantDb();
      await tx.insert(schema.invitations).values({ id: invitationId, orgId, email, role, tokenHash, expiresAt });
      const [row] = await tx
        .select({ name: schema.organizations.name })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
      return row;
    });

    const inviteUrl = `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/invitations/accept?token=${rawToken}`;
    await this.mailSender.send({
      to: email,
      subject: `You've been invited to join ${org?.name ?? 'an organization'} on Mobilio`,
      body: `Join here: ${inviteUrl}`,
    });

    return { invitationId };
  }

  async revokeInvitation(orgId: string, userId: string, invitationId: string): Promise<void> {
    await runInTenantContext(this.dbService.db, { orgId, userId }, () =>
      getTenantDb().delete(schema.invitations).where(eq(schema.invitations.id, invitationId)),
    );
  }

  async acceptInvitation(userId: string, userEmail: string, rawToken: string): Promise<{ orgId: string }> {
    const tokenHash = hashToken(rawToken);
    const invitation = await runInTokenLookupContext(this.dbService.db, tokenHash, async () => {
      const [row] = await getTenantDb().select().from(schema.invitations).where(eq(schema.invitations.tokenHash, tokenHash));
      return row;
    });

    if (!invitation || invitation.expiresAt < new Date() || invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new NotFoundException({ code: 'INVITATION_NOT_FOUND', message: 'Invitation not found or expired' });
    }

    const { orgId, role, id: invitationId } = invitation;
    await runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      // ON CONFLICT DO NOTHING, not check-then-insert: two concurrent accepts of the
      // same invitation (double-click, retried request) would otherwise both pass the
      // "no existing membership" check before either commits, then race the insert —
      // one succeeds, the other hits the unique constraint and 500s instead of just
      // being a no-op. The constraint target matches memberships_user_org_unique.
      await tx
        .insert(schema.memberships)
        .values({ userId, orgId, role })
        .onConflictDoNothing({ target: [schema.memberships.userId, schema.memberships.orgId] });
      await tx.delete(schema.invitations).where(eq(schema.invitations.id, invitationId));
    });

    return { orgId };
  }

  async changeRole(orgId: string, actingUserId: string, targetUserId: string, newRole: OrgRole): Promise<void> {
    await runInTenantContext(this.dbService.db, { orgId, userId: actingUserId }, async () => {
      const tx = getTenantDb();
      const [target] = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, targetUserId));
      if (!target) {
        throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Member not found' });
      }
      if (target.role === 'owner' && newRole !== 'owner') {
        await assertNotLastOwner(tx);
      }
      await tx.update(schema.memberships).set({ role: newRole }).where(eq(schema.memberships.userId, targetUserId));
    });
  }

  async removeMember(orgId: string, actingUserId: string, targetUserId: string): Promise<void> {
    await runInTenantContext(this.dbService.db, { orgId, userId: actingUserId }, async () => {
      const tx = getTenantDb();
      const [target] = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, targetUserId));
      if (!target) {
        throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Member not found' });
      }
      if (target.role === 'owner') {
        await assertNotLastOwner(tx);
      }
      await tx.delete(schema.memberships).where(eq(schema.memberships.userId, targetUserId));
    });
  }
}

/**
 * Shared by changeRole/removeMember — must run inside the same tenant transaction as
 * the write it guards, and before that write. FOR UPDATE locks every current owner row;
 * a second, concurrent demotion/removal targeting a *different* owner of the same org
 * blocks here until the first commits, then re-evaluates role = 'owner' against the
 * now-updated rows (standard Postgres SELECT ... FOR UPDATE behavior under READ
 * COMMITTED) — so it correctly sees one fewer owner and rejects, rather than both
 * racing transactions reading "2 owners" from their own pre-lock snapshot and leaving
 * the org with zero. A plain unlocked count can't catch this: two transactions started
 * before either commits both see the same stale "still safe" count.
 */
async function assertNotLastOwner(tx: ReturnType<typeof getTenantDb>): Promise<void> {
  const owners = await tx.select().from(schema.memberships).where(eq(schema.memberships.role, 'owner')).for('update');
  if (owners.length <= 1) {
    throw new ConflictException({ code: 'LAST_OWNER', message: 'The organization must keep at least one owner' });
  }
}
