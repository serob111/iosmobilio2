import crypto from 'crypto';

/** Constant-time check of the `x-build-secret` header used by the GitHub Actions workflow. */
export function checkBuildSecret(request: Request): boolean {
  const expected = process.env.BUILD_SECRET ?? '';
  if (!expected) return false;
  const provided = request.headers.get('x-build-secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
