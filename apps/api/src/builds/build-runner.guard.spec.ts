import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { BuildRunnerGuard } from './build-runner.guard.js';
import { hashBuildToken } from './build-token.js';
import './build.types.js';

const { runInBuildContextMock } = vi.hoisted(() => ({ runInBuildContextMock: vi.fn() }));

vi.mock('@mobilio/db', () => ({ runInBuildContext: runInBuildContextMock }));

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const RAW_TOKEN = 'a'.repeat(64);
const TOKEN_HASH = hashBuildToken(RAW_TOKEN);

describe('BuildRunnerGuard', () => {
  const guard = new BuildRunnerGuard({ db: {} } as never);

  beforeEach(() => {
    runInBuildContextMock.mockReset();
  });

  it('throws NotFoundException without querying the database when there is no Authorization header', async () => {
    const ctx = contextWithRequest({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(runInBuildContextMock).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the header is not a Bearer token', async () => {
    const ctx = contextWithRequest({ headers: { authorization: `Basic ${RAW_TOKEN}` } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(runInBuildContextMock).not.toHaveBeenCalled();
  });

  it('attaches request.build and request.buildTokenHash for a token that resolves to a live build', async () => {
    const build = {
      id: 'build-1',
      orgId: 'org-1',
      projectId: 'project-1',
      status: 'queued',
      tokenHash: TOKEN_HASH,
    };
    runInBuildContextMock.mockImplementation(async (_db: unknown, _tokenHash: string, fn: (b: unknown) => unknown) =>
      fn(build),
    );

    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${RAW_TOKEN}` } };
    const ctx = contextWithRequest(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.build).toBe(build);
    expect(request.buildTokenHash).toBe(TOKEN_HASH);
    expect(runInBuildContextMock.mock.calls[0]?.[1]).toBe(TOKEN_HASH);
  });

  it('throws NotFoundException when no build matches the token', async () => {
    runInBuildContextMock.mockResolvedValue(undefined);
    const ctx = contextWithRequest({ headers: { authorization: `Bearer ${RAW_TOKEN}` } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException if the resolved build somehow has a different token_hash than what was looked up (defense in depth)', async () => {
    runInBuildContextMock.mockImplementation(async (_db: unknown, _tokenHash: string, fn: (b: unknown) => unknown) =>
      fn({ id: 'build-1', orgId: 'org-1', projectId: 'project-1', status: 'queued', tokenHash: hashBuildToken('other') }),
    );
    const ctx = contextWithRequest({ headers: { authorization: `Bearer ${RAW_TOKEN}` } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException if the resolved build has a null token_hash', async () => {
    runInBuildContextMock.mockImplementation(async (_db: unknown, _tokenHash: string, fn: (b: unknown) => unknown) =>
      fn({ id: 'build-1', orgId: 'org-1', projectId: 'project-1', status: 'done', tokenHash: null }),
    );
    const ctx = contextWithRequest({ headers: { authorization: `Bearer ${RAW_TOKEN}` } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});
