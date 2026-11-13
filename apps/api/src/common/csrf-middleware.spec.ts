import { createCsrfMiddleware, validateCsrfTestEnv } from './csrf-middleware.js';

const WEB_ORIGIN = 'http://localhost:3100';

function fakeReq(overrides: {
  method: string;
  path: string;
  origin?: string;
  referer?: string;
}): { method: string; path: string; headers: Record<string, string | undefined> } {
  return {
    method: overrides.method,
    path: overrides.path,
    headers: { origin: overrides.origin, referer: overrides.referer },
  };
}

function fakeRes() {
  const res = {
    statusCode: 0,
    jsonBody: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
      return res;
    },
  };
  return res;
}

describe('createCsrfMiddleware', () => {
  const originalWebOrigin = process.env.WEB_ORIGIN;
  const originalDisabled = process.env.CSRF_DISABLED_FOR_TESTING;

  beforeEach(() => {
    process.env.WEB_ORIGIN = WEB_ORIGIN;
    delete process.env.CSRF_DISABLED_FOR_TESTING;
  });

  afterAll(() => {
    if (originalWebOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = originalWebOrigin;
    if (originalDisabled === undefined) delete process.env.CSRF_DISABLED_FOR_TESTING;
    else process.env.CSRF_DISABLED_FOR_TESTING = originalDisabled;
  });

  it('passes through safe methods (GET) regardless of Origin', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(fakeReq({ method: 'GET', path: '/drafts/me', origin: 'https://evil.example' }) as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('allows an unsafe method with a matching Origin', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(fakeReq({ method: 'PUT', path: '/drafts/me', origin: WEB_ORIGIN }) as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects an unsafe method with a foreign Origin as 403 CSRF_ORIGIN_MISMATCH', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(
      fakeReq({ method: 'POST', path: '/orgs/org1/projects', origin: 'https://evil.example' }) as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('rejects an unsafe method with neither an Origin nor a Referer header', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(fakeReq({ method: 'POST', path: '/drafts' }) as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('falls back to Referer when Origin is absent, accepting a matching one', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(
      fakeReq({ method: 'PUT', path: '/drafts/me', referer: `${WEB_ORIGIN}/try` }) as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a mismatched Referer the same as a mismatched Origin', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(
      fakeReq({ method: 'PUT', path: '/drafts/me', referer: 'https://evil.example/anything' }) as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('ignores Referer when Origin is present (Origin always wins, even if it mismatches and Referer would have matched)', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(
      fakeReq({ method: 'PUT', path: '/drafts/me', origin: 'https://evil.example', referer: `${WEB_ORIGIN}/try` }) as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it.each(['/api/auth/sign-in/magic-link', '/api/auth/callback/google'])(
    'excludes %s (Better Auth\'s own routes) regardless of Origin',
    (path) => {
      const middleware = createCsrfMiddleware();
      const next = vi.fn();
      const res = fakeRes();

      middleware(fakeReq({ method: 'POST', path }) as never, res as never, next);

      expect(next).toHaveBeenCalledOnce();
    },
  );

  it.each(['/builds/abc123/start', '/builds/abc123/ipa', '/builds/abc123/fail'])(
    'excludes the Bearer-authorized build runner route %s regardless of Origin',
    (path) => {
      const middleware = createCsrfMiddleware();
      const next = vi.fn();
      const res = fakeRes();

      middleware(fakeReq({ method: 'POST', path }) as never, res as never, next);

      expect(next).toHaveBeenCalledOnce();
    },
  );

  it('does NOT exclude /orgs/:orgId/projects/:projectId/builds (the session-cookie-authed start-a-build route)', () => {
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(
      fakeReq({ method: 'POST', path: '/orgs/org1/projects/proj1/builds', origin: 'https://evil.example' }) as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('bypasses the check entirely when CSRF_DISABLED_FOR_TESTING=true', () => {
    process.env.CSRF_DISABLED_FOR_TESTING = 'true';
    const middleware = createCsrfMiddleware();
    const next = vi.fn();
    const res = fakeRes();

    middleware(
      fakeReq({ method: 'POST', path: '/drafts', origin: 'https://evil.example' }) as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
  });
});

describe('validateCsrfTestEnv', () => {
  const originalDisabled = process.env.CSRF_DISABLED_FOR_TESTING;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalDisabled === undefined) delete process.env.CSRF_DISABLED_FOR_TESTING;
    else process.env.CSRF_DISABLED_FOR_TESTING = originalDisabled;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws when the escape hatch is enabled in production', () => {
    process.env.CSRF_DISABLED_FOR_TESTING = 'true';
    process.env.NODE_ENV = 'production';

    expect(() => validateCsrfTestEnv()).toThrow(/not allowed when NODE_ENV=production/);
  });

  it('does not throw when the escape hatch is enabled outside production', () => {
    process.env.CSRF_DISABLED_FOR_TESTING = 'true';
    process.env.NODE_ENV = 'test';

    expect(() => validateCsrfTestEnv()).not.toThrow();
  });

  it('does not throw in production when the escape hatch is disabled', () => {
    delete process.env.CSRF_DISABLED_FOR_TESTING;
    process.env.NODE_ENV = 'production';

    expect(() => validateCsrfTestEnv()).not.toThrow();
  });
});
