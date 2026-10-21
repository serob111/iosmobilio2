import { BadRequestException } from '@nestjs/common';
import { InvitationsController } from './invitations.controller.js';
import type { OrganizationsService } from './organizations.service.js';

describe('InvitationsController', () => {
  it('accepts an invitation using the authenticated user\'s id and email', async () => {
    const acceptInvitation = vi.fn().mockResolvedValue({ orgId: 'org-1' });
    const controller = new InvitationsController({ acceptInvitation } as unknown as OrganizationsService);
    const request = { user: { id: 'user-1', email: 'ada@example.com' } } as never;

    const result = await controller.accept(request, { token: 'raw-token' });

    expect(result).toEqual({ orgId: 'org-1' });
    expect(acceptInvitation).toHaveBeenCalledWith('user-1', 'ada@example.com', 'raw-token');
  });

  it('rejects a missing token', async () => {
    const controller = new InvitationsController({} as unknown as OrganizationsService);
    const request = { user: { id: 'user-1', email: 'ada@example.com' } } as never;

    await expect(controller.accept(request, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
