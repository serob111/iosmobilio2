import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { ProjectGuard } from './project.guard.js';
import './project.types.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';

const { runInTenantContextMock, getTenantDbMock } = vi.hoisted(() => ({
  runInTenantContextMock: vi.fn(),
  getTenantDbMock: vi.fn(),
}));

vi.mock('@mobilio/db', () => ({
  runInTenantContext: runInTenantContextMock,
  getTenantDb: getTenantDbMock,
  schema: { projects: { id: 'id' } },
  eq: vi.fn(),
}));

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const VALID_PROJECT_ID = '01a16033-3d3b-718f-b2f4-9508ec870bac';
const TENANT = { orgId: '01a16033-3d3b-718f-b2f4-9508ec870bab', userId: 'user-1' };

describe('ProjectGuard', () => {
  const guard = new ProjectGuard({ db: {} } as never);

  beforeEach(() => {
    runInTenantContextMock.mockReset();
    getTenantDbMock.mockReset();
  });

  it('attaches request.project and allows the request when the project exists in this org', async () => {
    runInTenantContextMock.mockImplementation(
      async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn(),
    );
    const row = {
      id: VALID_PROJECT_ID,
      name: 'Acme',
      sourceUrl: 'https://x',
      config: { trial: true },
      configVersion: 1,
    };
    getTenantDbMock.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [row] }) }),
    });

    const request: Record<string, unknown> = {
      params: { projectId: VALID_PROJECT_ID },
      tenant: TENANT,
    };
    const ctx = contextWithRequest(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.project).toEqual({
      id: VALID_PROJECT_ID,
      name: 'Acme',
      sourceUrl: 'https://x',
      config: { trial: true },
      configVersion: 1,
    });
  });

  it('throws NotFoundException when no project row matches (wrong id or wrong org)', async () => {
    runInTenantContextMock.mockImplementation(
      async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn(),
    );
    getTenantDbMock.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [] }) }),
    });

    const ctx = contextWithRequest({ params: { projectId: VALID_PROJECT_ID }, tenant: TENANT });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException (not an auth error) when there is no tenant on the request', async () => {
    const ctx = contextWithRequest({ params: { projectId: VALID_PROJECT_ID } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(runInTenantContextMock).not.toHaveBeenCalled();
  });

  it('throws NotFoundException without querying the database when projectId is not a valid uuid', async () => {
    const ctx = contextWithRequest({ params: { projectId: 'not-a-uuid' }, tenant: TENANT });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(runInTenantContextMock).not.toHaveBeenCalled();
  });
});
