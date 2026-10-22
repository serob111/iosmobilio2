import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import './auth.types.js';

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function fakeReflector(isPublic: boolean | undefined) {
  return { getAllAndOverride: () => isPublic } as never;
}

describe('AuthGuard', () => {
  it('attaches the user and allows the request when a session exists', async () => {
    const user = { id: 'user-1', name: 'Ada', email: 'ada@example.com' };
    const getSession = vi.fn().mockResolvedValue({ session: { id: 's1' }, user });
    const guard = new AuthGuard({ auth: { api: { getSession } } } as never, fakeReflector(false));

    const request: Record<string, unknown> = { headers: {} };
    const ctx = contextWithRequest(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBe(user);
  });

  it('throws UnauthorizedException when there is no session', async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const guard = new AuthGuard({ auth: { api: { getSession } } } as never, fakeReflector(false));

    const ctx = contextWithRequest({ headers: {} });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('skips the session check for routes marked @Public()', async () => {
    const getSession = vi.fn();
    const guard = new AuthGuard({ auth: { api: { getSession } } } as never, fakeReflector(true));

    const ctx = contextWithRequest({ headers: {} });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });
});
