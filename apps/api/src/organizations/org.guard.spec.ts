import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { OrgGuard } from './org.guard.js';
import './organizations.types.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';

const { runInTenantContextMock, getTenantDbMock } = vi.hoisted(() => ({
  runInTenantContextMock: vi.fn(),
  getTenantDbMock: vi.fn(),
}));

vi.mock('@mobilio/db', () => ({
  runInTenantContext: runInTenantContextMock,
  getTenantDb: getTenantDbMock,
  schema: { memberships: { role: 'role', userId: 'userId' } },
  eq: vi.fn(),
}));

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('OrgGuard', () => {
  const guard = new OrgGuard({ db: {} } as never);

  beforeEach(() => {
    runInTenantContextMock.mockReset();
    getTenantDbMock.mockReset();
  });

  it('attaches tenant + membership and allows the request when the user is a member', async () => {
    runInTenantContextMock.mockImplementation(async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn());
    getTenantDbMock.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [{ role: 'admin' }] }) }),
    });

    const request: Record<string, unknown> = { params: { orgId: 'org-1' }, user: { id: 'user-1' } };
    const ctx = contextWithRequest(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.tenant).toEqual({ orgId: 'org-1', userId: 'user-1' });
    expect(request.membership).toEqual({ role: 'admin' });
  });

  it('throws NotFoundException when the user has no membership row', async () => {
    runInTenantContextMock.mockImplementation(async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn());
    getTenantDbMock.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [] }) }),
    });

    const ctx = contextWithRequest({ params: { orgId: 'org-1' }, user: { id: 'user-1' } });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException (not an auth error) when there is no user on the request', async () => {
    const ctx = contextWithRequest({ params: { orgId: 'org-1' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(runInTenantContextMock).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when orgId is missing from the route', async () => {
    const ctx = contextWithRequest({ params: {}, user: { id: 'user-1' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});
