import { randomBytes, createHash } from 'node:crypto';

const BUILD_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export function hashBuildToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * The raw token is only ever handed to the runner via BuildRunner.dispatch() — never
 * returned to the user-facing POST /builds caller, and never stored itself, only its hash.
 */
export function generateBuildToken(): { rawToken: string; tokenHash: string; expiresAt: Date } {
  const rawToken = randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashBuildToken(rawToken), expiresAt: new Date(Date.now() + BUILD_TOKEN_TTL_MS) };
}
