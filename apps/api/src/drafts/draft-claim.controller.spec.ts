import { NotFoundException } from '@nestjs/common';
import { DraftClaimController } from './draft-claim.controller.js';
import type { DraftsService } from './drafts.service.js';
import { DRAFT_COOKIE_NAME } from './draft-token.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';

function fakeService(overrides: Partial<Record<keyof DraftsService, ReturnType<typeof vi.fn>>> = {}) {
  return { claimDraft: vi.fn(), ...overrides } as unknown as DraftsService;
}

function fakeResponse() {
  return { clearCookie: vi.fn() };
}

const TENANT = { orgId: 'org-1', userId: 'user-1' };

describe('DraftClaimController', () => {
  it('404s without calling the service when there is no draft cookie', async () => {
    const claimDraft = vi.fn();
    const controller = new DraftClaimController(fakeService({ claimDraft }));
    const request = { headers: {}, tenant: TENANT } as never;

    await expect(controller.claim(request, fakeResponse() as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(claimDraft).not.toHaveBeenCalled();
  });

  it('claims the draft using the tenant from OrgGuard and the token from the cookie, then clears the cookie', async () => {
    const claimDraft = vi.fn().mockResolvedValue({ id: 'project-1' });
    const controller = new DraftClaimController(fakeService({ claimDraft }));
    const res = fakeResponse();
    const request = { headers: { cookie: `${DRAFT_COOKIE_NAME}=raw-token` }, tenant: TENANT } as never;

    const result = await controller.claim(request, res as never);

    expect(result).toEqual({ id: 'project-1' });
    expect(claimDraft).toHaveBeenCalledWith('org-1', 'user-1', 'raw-token');
    expect(res.clearCookie).toHaveBeenCalledWith(DRAFT_COOKIE_NAME, { path: '/' });
  });
});
