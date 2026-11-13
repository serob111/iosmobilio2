/**
 * Called once at app bootstrap, same timing/rationale as validateBuildEnv()/
 * validatePreviewEnv() — a production deployment still running on a value copied
 * straight out of this repo's own committed docker-compose.yml/apps/api/.env.example
 * (or a secret that's merely short, not necessarily *that* exact placeholder) should
 * refuse to start rather than boot successfully with a secret an attacker who's read
 * this public repo could guess outright.
 *
 * Deliberately never includes the actual value in any thrown message — only ever
 * names the offending variable — so a leaked error (log aggregator, crash reporter,
 * terminal scrollback) can't also leak the secret it's complaining about.
 */

// Checked against all three vars below, not just the one each literally appears next
// to in docker-compose.yml/.env.example — a value copy-pasted into the wrong var is
// just as much a real-world mistake as leaving its own var on the default.
const KNOWN_DEV_PLACEHOLDER_VALUES = new Set([
  'dev-only-not-a-real-secret', // docker-compose.yml / apps/api/.env.example: BETTER_AUTH_SECRET
  'bW9iaWxpby1kZXYtb25seS1wcmV2aWV3LXNsdWctayE=', // docker-compose.yml: PREVIEW_SLUG_KEY
]);

const SECRET_ENV_VARS = ['BETTER_AUTH_SECRET', 'PREVIEW_SLUG_KEY', 'BUILD_TOKEN_KEY'] as const;

// Better Auth's own secret, used to sign/encrypt session tokens — anything shorter is
// trivially brute-forceable. PREVIEW_SLUG_KEY/BUILD_TOKEN_KEY have no entry here:
// validatePreviewEnv()/validateBuildEnv() already require each to decode to exactly 32
// raw bytes, unconditionally, in every environment — a minimum length check here would
// just duplicate that.
const MIN_SECRET_LENGTH: Partial<Record<(typeof SECRET_ENV_VARS)[number], number>> = {
  BETTER_AUTH_SECRET: 32,
};

export function validateProductionSecretsEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    // Unset entirely is each var's own validator's job (e.g. validatePreviewEnv already
    // requires PREVIEW_SLUG_KEY unconditionally; validateBuildEnv requires
    // BUILD_TOKEN_KEY only when BUILD_RUNNER isn't "fake", which is itself refused in
    // production separately).
    if (!value) continue;

    if (KNOWN_DEV_PLACEHOLDER_VALUES.has(value)) {
      throw new Error(
        `${name} must not be a default development placeholder value from docker-compose.yml/apps/api/.env.example when NODE_ENV=production`,
      );
    }
    const minLength = MIN_SECRET_LENGTH[name];
    if (minLength !== undefined && value.length < minLength) {
      throw new Error(`${name} must be at least ${minLength} characters when NODE_ENV=production`);
    }
  }

  // draft-token.ts's isSecureCookie() treats anything other than the exact string
  // "false" as secure (fail safe, not fail open) — this mirrors that exact comparison
  // so the two can never disagree about what counts as "insecure".
  if (process.env.COOKIE_SECURE === 'false') {
    throw new Error('COOKIE_SECURE must not be "false" when NODE_ENV=production — cookies must be Secure (HTTPS-only)');
  }
}
