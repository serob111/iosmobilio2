import { MeController } from './me.controller.js';
import type { OrganizationsService } from './organizations.service.js';

describe('MeController', () => {
  it('returns the authenticated user plus their organizations', async () => {
    const user = { id: 'u1', name: 'Ada', email: 'ada@example.com' };
    const organizations = [{ id: 'org1', name: 'Acme', slug: 'acme', role: 'owner' as const }];
    const getUserOrganizations = vi.fn().mockResolvedValue(organizations);
    const controller = new MeController({ getUserOrganizations } as unknown as OrganizationsService);

    const result = await controller.getMe({ user } as never);

    expect(result).toEqual({ user, organizations });
    expect(getUserOrganizations).toHaveBeenCalledWith('u1');
  });
});
