import { BadRequestException } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller.js';
import type { OrganizationsService } from './organizations.service.js';

function fakeService(overrides: Partial<Record<keyof OrganizationsService, ReturnType<typeof vi.fn>>> = {}) {
  return {
    createOrganization: vi.fn(),
    getOrganization: vi.fn(),
    inviteMember: vi.fn(),
    revokeInvitation: vi.fn(),
    changeRole: vi.fn(),
    removeMember: vi.fn(),
    ...overrides,
  } as unknown as OrganizationsService;
}

const request = { user: { id: 'user-1' }, tenant: { orgId: 'org-1', userId: 'user-1' } } as never;

describe('OrganizationsController', () => {
  describe('create', () => {
    it('creates an org for the authenticated user', async () => {
      const createOrganization = vi.fn().mockResolvedValue({ orgId: 'org-1', slug: 'acme' });
      const controller = new OrganizationsController(fakeService({ createOrganization }));

      const result = await controller.create(request, { name: 'Acme' });

      expect(result).toEqual({ orgId: 'org-1', slug: 'acme' });
      expect(createOrganization).toHaveBeenCalledWith('user-1', 'Acme');
    });

    it('rejects a missing name', async () => {
      const controller = new OrganizationsController(fakeService());
      await expect(controller.create(request, {})).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getOne', () => {
    it('delegates to the service with the tenant from OrgGuard', async () => {
      const org = { id: 'org-1', name: 'Acme', slug: 'acme', members: [] };
      const getOrganization = vi.fn().mockResolvedValue(org);
      const controller = new OrganizationsController(fakeService({ getOrganization }));

      await expect(controller.getOne(request)).resolves.toBe(org);
      expect(getOrganization).toHaveBeenCalledWith('org-1', 'user-1');
    });
  });

  describe('invite', () => {
    it('validates email and role before calling the service', async () => {
      const inviteMember = vi.fn().mockResolvedValue({ invitationId: 'inv-1' });
      const controller = new OrganizationsController(fakeService({ inviteMember }));

      const result = await controller.invite(request, { email: 'a@example.com', role: 'member' });

      expect(result).toEqual({ invitationId: 'inv-1' });
      expect(inviteMember).toHaveBeenCalledWith('org-1', 'user-1', 'a@example.com', 'member');
    });

    it('rejects an invalid role', async () => {
      const controller = new OrganizationsController(fakeService());
      await expect(controller.invite(request, { email: 'a@example.com', role: 'root' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('revokeInvitation', () => {
    it('delegates to the service', async () => {
      const revokeInvitation = vi.fn().mockResolvedValue(undefined);
      const controller = new OrganizationsController(fakeService({ revokeInvitation }));

      await controller.revokeInvitation(request, 'inv-1');

      expect(revokeInvitation).toHaveBeenCalledWith('org-1', 'user-1', 'inv-1');
    });
  });

  describe('changeRole', () => {
    it('validates the role and delegates to the service', async () => {
      const changeRole = vi.fn().mockResolvedValue(undefined);
      const controller = new OrganizationsController(fakeService({ changeRole }));

      const result = await controller.changeRole(request, 'target-1', { role: 'admin' });

      expect(result).toEqual({ status: 'ok' });
      expect(changeRole).toHaveBeenCalledWith('org-1', 'user-1', 'target-1', 'admin');
    });
  });

  describe('removeMember', () => {
    it('delegates to the service', async () => {
      const removeMember = vi.fn().mockResolvedValue(undefined);
      const controller = new OrganizationsController(fakeService({ removeMember }));

      await controller.removeMember(request, 'target-1');

      expect(removeMember).toHaveBeenCalledWith('org-1', 'user-1', 'target-1');
    });
  });
});
