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
        // without PREVIEW_PROXY_DOMAIN set to a different registrable domain from
        // WEB_ORIGIN above. "preview.localhost" (not bare "localhost", which would
        // collide with WEB_ORIGIN's own hostname) — Chromium (and most modern browsers)
        // resolve *any* `*.localhost`-suffixed hostname, at any subdomain depth, straight
        // to loopback with no DNS/hosts-file entry needed, which is exactly what
        // preview-proxy.spec.ts needs for its own cross-origin isolation test to reach a
        // real preview subdomain (`<slug>.preview.localhost`) in a sandbox with no
        // outbound internet access. preview.spec.ts (the shell-page test, mocked at the
        // browser's network boundary) never needs this to be reachable at all, only to
        // satisfy startup validation here either way. http, not https — no TLS cert for
        // *.localhost exists in this environment.
        PREVIEW_PROXY_DOMAIN: 'preview.localhost',
        PREVIEW_PROXY_SCHEME: 'http',
        // This api answers on :3011, not the scheme's default port — without this,
        // every generated preview link would silently point at :80, where nothing here
        // is listening. Real deployments (always on 443 behind a reverse proxy) never set this.
        PREVIEW_PROXY_PORT: '3011',
        // Lets the real api's safeFetch/proxyFetch calls reach the real local "site"
        // servers preview-proxy.spec.ts spins up itself — see
        // net/safe-fetch.ts's getSafeFetchTestOverrides for why this is scoped to
        // 127.0.0.1/::1 only, and refused outright if NODE_ENV=production.
        SAFE_FETCH_ALLOW_LOCAL_FOR_TESTING: 'true',
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
