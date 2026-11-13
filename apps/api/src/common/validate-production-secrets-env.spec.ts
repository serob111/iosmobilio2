import { randomBytes } from 'node:crypto';
import { validateProductionSecretsEnv } from './validate-production-secrets-env.js';

const VALID_SECRET = randomBytes(32).toString('base64url'); // 43 chars, well over the 32-char floor
const DEV_AUTH_SECRET_PLACEHOLDER = 'dev-only-not-a-real-secret';
const DEV_SLUG_KEY_PLACEHOLDER = 'bW9iaWxpby1kZXYtb25seS1wcmV2aWV3LXNsdWctayE=';

describe('validateProductionSecretsEnv', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function setValidProductionEnv(): void {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = VALID_SECRET;
    process.env.PREVIEW_SLUG_KEY = VALID_SECRET;
    process.env.BUILD_TOKEN_KEY = VALID_SECRET;
    process.env.COOKIE_SECURE = 'true';
  }

  it('passes with every secret set to a long, non-placeholder value in production', () => {
    setValidProductionEnv();
    expect(() => validateProductionSecretsEnv()).not.toThrow();
  });

  it('is a no-op outside production, even with every placeholder value set', () => {
    process.env.NODE_ENV = 'test';
    process.env.BETTER_AUTH_SECRET = DEV_AUTH_SECRET_PLACEHOLDER;
    process.env.PREVIEW_SLUG_KEY = DEV_SLUG_KEY_PLACEHOLDER;
    process.env.BUILD_TOKEN_KEY = DEV_SLUG_KEY_PLACEHOLDER;
    process.env.COOKIE_SECURE = 'false';
    expect(() => validateProductionSecretsEnv()).not.toThrow();
  });

  it('throws naming BETTER_AUTH_SECRET, without printing its value, when it is the docker-compose.yml/.env.example placeholder', () => {
    setValidProductionEnv();
    process.env.BETTER_AUTH_SECRET = DEV_AUTH_SECRET_PLACEHOLDER;
    let error: unknown;
    try {
      validateProductionSecretsEnv();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('BETTER_AUTH_SECRET');
    expect((error as Error).message).not.toContain(DEV_AUTH_SECRET_PLACEHOLDER);
  });

  it('throws naming BETTER_AUTH_SECRET when it is shorter than 32 characters, even if not the exact placeholder', () => {
    setValidProductionEnv();
    process.env.BETTER_AUTH_SECRET = 'short-but-not-the-placeholder';
    expect(() => validateProductionSecretsEnv()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('throws naming PREVIEW_SLUG_KEY, without printing its value, when it is the docker-compose.yml placeholder', () => {
    setValidProductionEnv();
    process.env.PREVIEW_SLUG_KEY = DEV_SLUG_KEY_PLACEHOLDER;
    let error: unknown;
    try {
      validateProductionSecretsEnv();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('PREVIEW_SLUG_KEY');
    expect((error as Error).message).not.toContain(DEV_SLUG_KEY_PLACEHOLDER);
  });

  it('throws naming BUILD_TOKEN_KEY, without printing its value, when it was copy-pasted from a different var\'s known placeholder', () => {
    setValidProductionEnv();
    process.env.BUILD_TOKEN_KEY = DEV_SLUG_KEY_PLACEHOLDER;
    let error: unknown;
    try {
      validateProductionSecretsEnv();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('BUILD_TOKEN_KEY');
    expect((error as Error).message).not.toContain(DEV_SLUG_KEY_PLACEHOLDER);
  });

  it('does not check BUILD_TOKEN_KEY at all when it is unset (BUILD_RUNNER=fake is validateBuildEnv\'s job to reject)', () => {
    setValidProductionEnv();
    delete process.env.BUILD_TOKEN_KEY;
    expect(() => validateProductionSecretsEnv()).not.toThrow();
  });

  it('throws naming COOKIE_SECURE, without printing any value, when it is exactly "false" in production', () => {
    setValidProductionEnv();
    process.env.COOKIE_SECURE = 'false';
    let error: unknown;
    try {
      validateProductionSecretsEnv();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('COOKIE_SECURE');
  });

  it('allows COOKIE_SECURE unset in production (defaults secure, same as draft-token.ts\'s isSecureCookie)', () => {
    setValidProductionEnv();
    delete process.env.COOKIE_SECURE;
    expect(() => validateProductionSecretsEnv()).not.toThrow();
  });
});
