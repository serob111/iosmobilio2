import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ShellReleaseAuthGuard } from './shell-release-auth.guard.js';

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const SECRET = 'a-very-long-static-shared-secret-value';

describe('ShellReleaseAuthGuard', () => {
  const guard = new ShellReleaseAuthGuard();
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows a request whose Bearer token matches SHELL_RELEASE_SECRET exactly', () => {
    process.env.SHELL_RELEASE_SECRET = SECRET;
    const ctx = contextWithRequest({ headers: { authorization: `Bearer ${SECRET}` } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException when there is no Authorization header', () => {
    process.env.SHELL_RELEASE_SECRET = SECRET;
    const ctx = contextWithRequest({ headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the header is not a Bearer token', () => {
    process.env.SHELL_RELEASE_SECRET = SECRET;
    const ctx = contextWithRequest({ headers: { authorization: `Basic ${SECRET}` } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token does not match', () => {
    process.env.SHELL_RELEASE_SECRET = SECRET;
    const ctx = contextWithRequest({ headers: { authorization: 'Bearer wrong-secret' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token differs only in length from the real secret', () => {
    process.env.SHELL_RELEASE_SECRET = SECRET;
    const ctx = contextWithRequest({ headers: { authorization: `Bearer ${SECRET}-extra` } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when SHELL_RELEASE_SECRET is not configured at all, even with a correct-looking token', () => {
    delete process.env.SHELL_RELEASE_SECRET;
    const ctx = contextWithRequest({ headers: { authorization: `Bearer ${SECRET}` } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
