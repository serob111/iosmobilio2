/**
 * Called once at app bootstrap (createApp(), before NestFactory even runs) — a
 * misconfigured deployment should fail to start outright, not boot successfully and
 * only discover it's missing a required secret on the first real build request (or,
 * worse, silently fall back to BUILD_RUNNER=fake in production and record builds that
 * never actually dispatch anywhere).
 */
export function validateBuildEnv(): void {
  const runner = process.env.BUILD_RUNNER ?? 'github';

  if (runner === 'fake') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BUILD_RUNNER=fake is not allowed when NODE_ENV=production');
    }
    return;
  }

  const apiPublicUrl = process.env.API_PUBLIC_URL;
  if (!apiPublicUrl || !apiPublicUrl.startsWith('https://')) {
    throw new Error('API_PUBLIC_URL must be set and start with https:// when BUILD_RUNNER is not "fake"');
  }
  if (!process.env.GITHUB_DISPATCH_TOKEN) {
    throw new Error('GITHUB_DISPATCH_TOKEN must be set when BUILD_RUNNER is not "fake"');
  }
  if (!process.env.GITHUB_REPO) {
    throw new Error('GITHUB_REPO must be set when BUILD_RUNNER is not "fake"');
  }

  const key = process.env.BUILD_TOKEN_KEY;
  if (!key) {
    throw new Error('BUILD_TOKEN_KEY must be set when BUILD_RUNNER is not "fake"');
  }
  if (Buffer.from(key, 'base64').length !== 32) {
    throw new Error('BUILD_TOKEN_KEY must decode to exactly 32 bytes (base64) when BUILD_RUNNER is not "fake"');
  }
}
