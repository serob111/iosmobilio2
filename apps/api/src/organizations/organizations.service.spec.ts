import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { DbService } from '../db/db.service.js';
import { MAIL_SENDER } from '../mail/mail-sender.js';

/** A query-builder chain stub: any method call returns itself, and awaiting it resolves to `result`. */
function chainTo(result: unknown): unknown {
  const target = () => chainTo(result);
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(result);
      }
      return () => chainTo(result);
    },
    apply() {
      return chainTo(result);
    },
  });
}

const { runInTenantContextMock, runInUserContextMock, runInTokenLookupContextMock, getTenantDbMock, insertMock, valuesMock } =
  vi.hoisted(() => {
    // Chainable, not a plain resolved promise: acceptInvitation now calls
    // .values(...).onConflictDoNothing(...), and chainTo() supports both awaiting
    // directly and chaining further query-builder methods off the same return value.
    const valuesMock = vi.fn().mockReturnValue(chainTo(undefined));
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    const getTenantDbMock = vi.fn().mockReturnValue({ insert: insertMock });
    const runInTenantContextMock = vi.fn(async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn());
    const runInUserContextMock = vi.fn(async (_db: unknown, _userId: unknown, fn: () => Promise<unknown>) => fn());
    const runInTokenLookupContextMock = vi.fn(
      async (_db: unknown, _hash: unknown, fn: () => Promise<unknown>) => fn(),
    );
    return {
      runInTenantContextMock,
      runInUserContextMock,
      runInTokenLookupContextMock,
      getTenantDbMock,
      insertMock,
      valuesMock,
    };
  });

vi.mock('@mobilio/db', () => ({
  runInTenantContext: runInTenantContextMock,
  runInUserContext: runInUserContextMock,
  runInTokenLookupContext: runInTokenLookupContextMock,
  getTenantDb: getTenantDbMock,
  schema: {
    organizations: 'organizations-table',
    memberships: 'memberships-table',
    invitations: 'invitations-table',
    users: 'users-table',
  },
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock('@mobilio/config', () => ({
  slugify: (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
}));

vi.mock('../db/db.service.js', () => ({
  DbService: class {
    db = {};
  },
}));

describe('OrganizationsService', () => {
  let mailSenderSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runInTenantContextMock.mockClear();
    runInUserContextMock.mockClear();
    runInTokenLookupContextMock.mockClear();
    getTenantDbMock.mockReset().mockReturnValue({ insert: insertMock });
    insertMock.mockClear();
    valuesMock.mockClear();
    mailSenderSend = vi.fn().mockResolvedValue(undefined);
  });

  async function buildService(): Promise<OrganizationsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [OrganizationsService, DbService, { provide: MAIL_SENDER, useValue: { send: mailSenderSend } }],
    }).compile();
    return moduleRef.get(OrganizationsService);
  }

  describe('createPersonalOrganization', () => {
    it('uses the given name for the org display name and slug', async () => {
      const service = await buildService();
      await service.createPersonalOrganization('user-1', 'Ada Lovelace', 'ada@example.com');

      expect(valuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: "Ada Lovelace's workspace" }));
      const orgInsertArg = valuesMock.mock.calls[0]?.[0] as { slug: string };
      expect(orgInsertArg.slug.startsWith('ada-lovelace-')).toBe(true);
    });

    it('falls back to the email local-part when name is blank (magic-link signups)', async () => {
      const service = await buildService();
      await service.createPersonalOrganization('user-1', '', 'ada@example.com');

      expect(valuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: "ada's workspace" }));
    });

    it('creates the membership as owner for the same org/user', async () => {
      const service = await buildService();
      const { orgId } = await service.createPersonalOrganization('user-1', 'Ada', 'ada@example.com');

      expect(valuesMock).toHaveBeenNthCalledWith(2, { userId: 'user-1', orgId, role: 'owner' });
    });

    it('runs both inserts inside the same tenant context, scoped to the new org', async () => {
      const service = await buildService();
      const { orgId } = await service.createPersonalOrganization('user-1', 'Ada', 'ada@example.com');

      expect(runInTenantContextMock).toHaveBeenCalledTimes(1);
      expect(runInTenantContextMock.mock.calls[0]?.[1]).toEqual({ orgId, userId: 'user-1' });
    });
  });

  describe('createOrganization', () => {
    it('uses the given name directly, not a "workspace" suffix', async () => {
      const service = await buildService();
      await service.createOrganization('user-1', 'Acme Inc');
      expect(valuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'Acme Inc' }));
    });
  });

  describe('getUserOrganizations', () => {
    it('queries through runInUserContext, not runInTenantContext', async () => {
      const rows = [{ id: 'org-1', name: 'Org', slug: 'org', role: 'owner' }];
      getTenantDbMock.mockReturnValue(chainTo(rows));

      const service = await buildService();
      const result = await service.getUserOrganizations('user-1');

      expect(result).toBe(rows);
      expect(runInUserContextMock).toHaveBeenCalledTimes(1);
      expect(runInUserContextMock.mock.calls[0]?.[1]).toBe('user-1');
      expect(runInTenantContextMock).not.toHaveBeenCalled();
    });
  });

  describe('getOrganization', () => {
    it('returns the org plus its members, scoped to orgId/userId', async () => {
      const org = { id: 'org-1', name: 'Acme', slug: 'acme' };
      const members = [{ userId: 'user-1', role: 'owner', name: 'Ada', email: 'ada@example.com' }];
      const select = vi.fn().mockReturnValueOnce(chainTo([org])).mockReturnValueOnce(chainTo(members));
      getTenantDbMock.mockReturnValue({ select });

      const service = await buildService();
      const result = await service.getOrganization('org-1', 'user-1');

      expect(result).toEqual({ id: 'org-1', name: 'Acme', slug: 'acme', members });
      expect(runInTenantContextMock.mock.calls[0]?.[1]).toEqual({ orgId: 'org-1', userId: 'user-1' });
    });
  });

  describe('inviteMember', () => {
    it('sends an invite email with a link containing the raw token', async () => {
      const select = vi.fn().mockReturnValue(chainTo([{ name: 'Acme' }]));
      getTenantDbMock.mockReturnValue({ insert: insertMock, select });

      const service = await buildService();
      await service.inviteMember('org-1', 'owner-1', 'invitee@example.com', 'member');

      expect(insertMock).toHaveBeenCalled();
      const inserted = valuesMock.mock.calls[0]?.[0] as { email: string; role: string; tokenHash: string };
      expect(inserted.email).toBe('invitee@example.com');
      expect(inserted.role).toBe('member');
      expect(inserted.tokenHash).toHaveLength(64); // sha256 hex

      expect(mailSenderSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invitee@example.com',
          body: expect.stringContaining('/invitations/accept?token='),
        }),
      );
    });
  });

  describe('acceptInvitation', () => {
    it('rejects when no invitation matches the token', async () => {
      getTenantDbMock.mockReturnValue(chainTo([]));
      const service = await buildService();

      await expect(service.acceptInvitation('user-1', 'user@example.com', 'bad-token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects when the invitation is expired', async () => {
      const invitation = {
        id: 'inv-1',
        orgId: 'org-1',
        role: 'member',
        email: 'user@example.com',
        expiresAt: new Date(Date.now() - 1000),
      };
      getTenantDbMock.mockReturnValue(chainTo([invitation]));
      const service = await buildService();

      await expect(service.acceptInvitation('user-1', 'user@example.com', 'token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("rejects when the accepting user's email doesn't match the invitation (case-insensitively allowed)", async () => {
      const invitation = {
        id: 'inv-1',
        orgId: 'org-1',
        role: 'member',
        email: 'invited@example.com',
        expiresAt: new Date(Date.now() + 60_000),
      };
      getTenantDbMock.mockReturnValue(chainTo([invitation]));
      const service = await buildService();

      await expect(service.acceptInvitation('user-1', 'someone-else@example.com', 'token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('creates the membership and deletes the invitation on success', async () => {
      const invitation = {
        id: 'inv-1',
        orgId: 'org-1',
        role: 'member',
        email: 'USER@example.com',
        expiresAt: new Date(Date.now() + 60_000),
      };
      const deleteMock = vi.fn().mockReturnValue(chainTo(undefined));

      getTenantDbMock
        .mockReturnValueOnce(chainTo([invitation])) // token lookup
        .mockReturnValueOnce({ insert: insertMock, delete: deleteMock }); // accept tx

      const service = await buildService();
      const result = await service.acceptInvitation('user-1', 'user@example.com', 'token');

      expect(result).toEqual({ orgId: 'org-1' });
      expect(insertMock).toHaveBeenCalled();
      expect(valuesMock).toHaveBeenCalledWith({ userId: 'user-1', orgId: 'org-1', role: 'member' });
      expect(deleteMock).toHaveBeenCalled();
    });

    it('inserts via ON CONFLICT DO NOTHING rather than a check-then-insert, so a duplicate accept is a safe no-op', async () => {
      const invitation = {
        id: 'inv-1',
        orgId: 'org-1',
        role: 'member',
        email: 'user@example.com',
        expiresAt: new Date(Date.now() + 60_000),
      };
      const onConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);
      const scopedValuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictDoNothingMock });
      const scopedInsertMock = vi.fn().mockReturnValue({ values: scopedValuesMock });
      const deleteMock = vi.fn().mockReturnValue(chainTo(undefined));

      getTenantDbMock
        .mockReturnValueOnce(chainTo([invitation]))
        .mockReturnValueOnce({ insert: scopedInsertMock, delete: deleteMock });

      const service = await buildService();
      await service.acceptInvitation('user-1', 'user@example.com', 'token');

      expect(scopedValuesMock).toHaveBeenCalledWith({ userId: 'user-1', orgId: 'org-1', role: 'member' });
      expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalled();
    });
  });

  describe('changeRole', () => {
    it('throws NotFoundException when the target is not a member', async () => {
      getTenantDbMock.mockReturnValue({ select: () => chainTo([]) });
      const service = await buildService();

      await expect(service.changeRole('org-1', 'owner-1', 'ghost', 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ConflictException when demoting the last owner', async () => {
      const select = vi
        .fn()
        .mockReturnValueOnce(chainTo([{ role: 'owner' }])) // target lookup
        .mockReturnValueOnce(chainTo([{ role: 'owner' }])); // owners count
      getTenantDbMock.mockReturnValue({ select, update: vi.fn() });

      const service = await buildService();

      await expect(service.changeRole('org-1', 'owner-1', 'owner-1', 'member')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('allows demoting an owner when another owner remains', async () => {
      const update = vi.fn().mockReturnValue({ set: () => chainTo(undefined) });
      const select = vi
        .fn()
        .mockReturnValueOnce(chainTo([{ role: 'owner' }]))
        .mockReturnValueOnce(chainTo([{ role: 'owner' }, { role: 'owner' }]));
      getTenantDbMock.mockReturnValue({ select, update });

      const service = await buildService();
      await service.changeRole('org-1', 'owner-1', 'owner-2', 'member');

      expect(update).toHaveBeenCalled();
    });

    it('allows changing role for a non-owner without checking the owner count', async () => {
      const update = vi.fn().mockReturnValue({ set: () => chainTo(undefined) });
      const select = vi.fn().mockReturnValueOnce(chainTo([{ role: 'member' }]));
      getTenantDbMock.mockReturnValue({ select, update });

      const service = await buildService();
      await service.changeRole('org-1', 'owner-1', 'member-1', 'admin');

      expect(select).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('throws NotFoundException when the target is not a member', async () => {
      getTenantDbMock.mockReturnValue({ select: () => chainTo([]) });
      const service = await buildService();

      await expect(service.removeMember('org-1', 'owner-1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when removing the last owner', async () => {
      const select = vi
        .fn()
        .mockReturnValueOnce(chainTo([{ role: 'owner' }]))
        .mockReturnValueOnce(chainTo([{ role: 'owner' }]));
      getTenantDbMock.mockReturnValue({ select, delete: vi.fn() });

      const service = await buildService();

      await expect(service.removeMember('org-1', 'owner-1', 'owner-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows removing a non-owner', async () => {
      const deleteMock = vi.fn().mockReturnValue(chainTo(undefined));
      const select = vi.fn().mockReturnValueOnce(chainTo([{ role: 'member' }]));
      getTenantDbMock.mockReturnValue({ select, delete: deleteMock });

      const service = await buildService();
      await service.removeMember('org-1', 'owner-1', 'member-1');

      expect(deleteMock).toHaveBeenCalled();
    });
  });
});
