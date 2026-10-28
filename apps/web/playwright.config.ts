import { defineConfig, devices } from '@playwright/test';
import { MAIL_LOG_FILE } from './e2e/mailLog';

// Local defaults match this repo's docker-compose host ports (see root .env.example);
// CI's e2e job overrides these to match its services: containers (see ci.yml).
const apiDatabaseUrl = process.env.E2E_API_DATABASE_URL ?? 'postgres://mobilio_app:mobilio_app_pw@localhost:5433/mobilio';
const apiRedisUrl = process.env.E2E_API_REDIS_URL ?? 'redis://localhost:6380';
const apiS3Endpoint = process.env.E2E_API_S3_ENDPOINT ?? 'http://localhost:9000';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx e2e/server.ts',
      port: 3100,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3011',
      },
    },
    {
      // A real apps/api (not mocked) — auth.spec.ts needs genuine session cookies,
      // RLS-backed org isolation and a real magic-link round trip, none of which a
      // browser-side page.route() mock could prove without becoming a tautology.
      // `nest start`, not `tsx src/main.ts` — tsx's esbuild-based transform doesn't
      // reliably emit TypeScript's decorator metadata that Nest's constructor DI
      // depends on, causing "can't resolve dependencies" at boot.
      command: 'npx nest start',
      cwd: '../api',
      port: 3011,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: apiDatabaseUrl,
        REDIS_URL: apiRedisUrl,
        BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-use-only',
        WEB_ORIGIN: 'http://localhost:3100',
        API_BASE_URL: 'http://localhost:3011',
        PORT: '3011',
        MAIL_LOG_FILE,
        // validatePreviewEnv (src/preview/validate-preview-env.ts) refuses to start
        // without this — a different registrable domain from WEB_ORIGIN above. Nothing
        // in this e2e suite actually calls the proxy itself (preview.spec.ts mocks
        // apps/api at the browser network boundary via page.route(), the same way
        // e2e/server.ts mocks the analyzed site for the legacy flow), so this never
        // needs to be reachable — it only needs to satisfy startup validation.
        PREVIEW_PROXY_ORIGIN: 'http://preview.e2e.invalid:3011',
        // StorageModule refuses to start without all four of these (createObjectStorageFromEnv) —
        // this suite never exercises file upload/download itself, so these just need to be set,
        // not correct against a real bucket.
        S3_ENDPOINT: apiS3Endpoint,
        S3_BUCKET: 'mobilio',
        S3_ACCESS_KEY_ID: 'mobilio',
        S3_SECRET_ACCESS_KEY: 'mobilio_minio_pw',
        S3_FORCE_PATH_STYLE: 'true',
        // This suite never exercises the builds feature — "fake" avoids
        // validateBuildEnv (src/builds/validate-build-env.ts) refusing to boot over
        // GITHUB_DISPATCH_TOKEN/API_PUBLIC_URL/BUILD_TOKEN_KEY not being configured here.
        BUILD_RUNNER: 'fake',
      },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
