import type { NextFunction, Request, Response } from 'express';
import './request-id.types.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Not cookie-authorized against *this* origin, so an Origin check doesn't apply:
 * - /api/auth/* — Better Auth's own routes, which have their own trusted-origin model
 *   (see signInByMagicLink's existing `.set('Origin', ...)` calls across the
 *   integration specs) and aren't "our" controllers.
 * - /builds/* — BuildRunnerController, authorized by a Bearer token (BuildRunnerGuard),
 *   never by a cookie. A CSRF defense exists to stop a browser from automatically
 *   attaching a cookie to a forged request; a bearer token in an Authorization header
 *   is never attached automatically, so there's nothing for this check to defend here.
 *
 * The preview proxy isn't in this list because it never reaches this middleware at
 * all — it's mounted ahead of everything else in create-app.ts and fully handles (or
 * passes through) any request whose Host header marks it as proxy territory.
 */
const EXCLUDED_PREFIXES = ['/api/auth', '/builds/'];

// Opt-in, env-gated escape hatch for integration tests that exercise some other
// feature and don't individually set an Origin header on every mutating request —
// same pattern as safe-fetch.ts's SAFE_FETCH_ALLOW_LOCAL_FOR_TESTING. The dedicated
// csrf.integration.spec.ts runs with this unset, so the real middleware is what's
// actually being verified there.
function csrfDisabledForTesting(): boolean {
  return process.env.CSRF_DISABLED_FOR_TESTING === 'true';
}

/** Called once at app bootstrap, same timing/rationale as validateSafeFetchTestEnv(). */
export function validateCsrfTestEnv(): void {
  if (csrfDisabledForTesting() && process.env.NODE_ENV === 'production') {
    throw new Error('CSRF_DISABLED_FOR_TESTING=true is not allowed when NODE_ENV=production');
  }
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Rejects cross-origin unsafe-method requests to apps/api's cookie-authorized routes
 * (the Better Auth session cookie, the draft cookie) — the browser always attaches
 * those cookies automatically, so without this check a third-party site could submit
 * a form or script-driven request that rides the victim's existing session/draft. The
 * Origin header (falling back to Referer, for the rare client that omits Origin on a
 * same-origin-looking request) must match WEB_ORIGIN's origin exactly; a request with
 * neither header at all is rejected too, same as a mismatched one.
 *
 * Especially relevant for the icon upload endpoints: a `multipart/form-data` POST is a
 * CORS "simple request" that never triggers a preflight, so the browser's own
 * same-origin/CORS machinery can't be relied on to stop a cross-site form from
 * submitting it.
 */
export function createCsrfMiddleware() {
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

  return function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (csrfDisabledForTesting()) {
      next();
      return;
    }
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (EXCLUDED_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }

    const originHeader = req.headers.origin;
    const refererHeader = req.headers.referer;
    const effectiveOrigin =
      (originHeader ? originOf(originHeader) : null) ?? (refererHeader ? originOf(refererHeader) : null);

    if (effectiveOrigin !== webOrigin) {
      // Matches HttpExceptionFilter's { error: { code, message, requestId } } shape —
      // this runs as plain Express middleware ahead of Nest, so it can't throw an
      // HttpException and let that filter format it, but apps/web's error parsing
      // (apiClient.ts's throwApiError) expects every error response shaped the same way.
      res.status(403).json({
        error: {
          code: 'CSRF_ORIGIN_MISMATCH',
          message: 'Origin does not match the expected web origin',
          requestId: req.id ?? 'unknown',
        },
      });
      return;
    }
    next();
  };
}
