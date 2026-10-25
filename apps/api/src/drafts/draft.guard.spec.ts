import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { DraftGuard } from './draft.guard.js';
import { DRAFT_COOKIE_NAME, hashDraftToken } from './draft-token.js';
import './draft.types.js';

const { runInTokenLookupContextMock, getTenantDbMock } = vi.hoisted(() => ({
  runInTokenLookupContextMock: vi.fn(),
  getTenantDbMock: vi.fn(),
}));

vi.mock('@mobilio/db', () => ({
  runInTokenLookupContext: runInTokenLookupContextMock,
  getTenantDb: getTenantDbMock,
  schema: { drafts: { tokenHash: 'tokenHash' } },
  eq: vi.fn(),
}));

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const RAW_TOKEN = 'a'.repeat(64);
const TOKEN_HASH = hashDraftToken(RAW_TOKEN);

describe('DraftGuard', () => {
  const guard = new DraftGuard({ db: {} } as never);

  beforeEach(() => {
    runInTokenLookupContextMock.mockReset();
    getTenantDbMock.mockReset();
  });

  it('throws NotFoundException without querying the database when there is no cookie at all', async () => {
    const ctx = contextWithRequest({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(runInTokenLookupContextMock).not.toHaveBeenCalled();
  });

  it('attaches request.draft and request.draftTokenHash when the token matches a live, unexpired draft', async () => {
    runInTokenLookupContextMock.mockImplementation(
      async (_db: unknown, _tokenHash: string, fn: () => Promise<unknown>) => fn(),
    );
    const row = {
      id: 'draft-1',
      name: 'Draft',
      sourceUrl: 'https://x',
      config: { trial: true },
      configVersion: 1,
      tokenHash: TOKEN_HASH,
      expiresAt: new Date(Date.now() + 60_000),
    };
    getTenantDbMock.mockReturnValue({ select: () => ({ from: () => ({ where: () => [row] }) }) });

    const request: Record<string, unknown> = { headers: { cookie: `${DRAFT_COOKIE_NAME}=${RAW_TOKEN}` } };
    const ctx = contextWithRequest(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.draft).toEqual({
      id: 'draft-1',
      name: 'Draft',
      sourceUrl: 'https://x',
      config: { trial: true },
      configVersion: 1,
      expiresAt: row.expiresAt,
    });
    expect(request.draftTokenHash).toBe(TOKEN_HASH);
    expect(runInTokenLookupContextMock.mock.calls[0]?.[1]).toBe(TOKEN_HASH);
  });

  it('throws NotFoundException when no draft row matches the token hash (including an expired one — RLS excludes it before the guard ever sees it)', async () => {
    runInTokenLookupContextMock.mockImplementation(
      async (_db: unknown, _tokenHash: string, fn: () => Promise<unknown>) => fn(),
    );
    getTenantDbMock.mockReturnValue({ select: () => ({ from: () => ({ where: () => [] }) }) });

    const ctx = contextWithRequest({ headers: { cookie: `${DRAFT_COOKIE_NAME}=${RAW_TOKEN}` } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});
