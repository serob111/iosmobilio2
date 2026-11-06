import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

const hasLiveServices =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.REDIS_URL) &&
  Boolean(process.env.BETTER_AUTH_SECRET) &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_BUCKET) &&
  Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error(
    'REQUIRE_LIVE_SERVICES=true but DATABASE_URL/REDIS_URL/BETTER_AUTH_SECRET/S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not all set',
  );
}

/**
 * Unlike builds.integration.spec.ts (which only needs BUILD_RUNNER=fake set before
 * app.init(), since the BUILD_RUNNER *provider* is a lazy useFactory resolved at DI time),
 * BuildsModule.controllers is a plain array evaluated once at the module file's own
 * import — by the time any other spec file's `beforeAll` could set BUILD_RUNNER, that
 * array has already been decided. test/setup.ts's global `BUILD_RUNNER ??= 'fake'`
 * default means create-app.js/builds.module.js get imported with BUILD_RUNNER='fake'
 * in every *other* file in this suite, which is why this one test lives alone: it
 * overrides BUILD_RUNNER *before* the dynamic import below, deliberately not using a
 * static top-level `import` (which ESM hoists above any other statement in the file,
 * including this override) for create-app.js.
 */
describe.skipIf(!hasLiveServices)('BuildsModule controller registration (live Postgres + Redis + MinIO)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.BUILD_RUNNER = 'github';
    // validateBuildEnv() requires all of these once BUILD_RUNNER isn't "fake" — not
    // exercised for real here (no test actually dispatches a build), just present so
    // createApp() doesn't refuse to boot at all.
    process.env.API_PUBLIC_URL = 'https://api.itest.example';
    process.env.GITHUB_DISPATCH_TOKEN = 'itest-token';
    process.env.GITHUB_REPO = 'itest/itest';
    process.env.BUILD_TOKEN_KEY = Buffer.alloc(32, 3).toString('base64');
    process.env.CSRF_DISABLED_FOR_TESTING = 'true';
    const { createApp } = await import('../create-app.js');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.BUILD_RUNNER;
    delete process.env.API_PUBLIC_URL;
    delete process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.GITHUB_REPO;
    delete process.env.BUILD_TOKEN_KEY;
    delete process.env.CSRF_DISABLED_FOR_TESTING;
  });

  it('never maps GET /_test/fake-runner/dispatched when BUILD_RUNNER is not "fake"', async () => {
    await request(app.getHttpServer()).get('/_test/fake-runner/dispatched').expect(404);
  });

  it('still maps an ordinary builds route normally (the app booted correctly, this isn\'t a broader routing failure)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
  });
});
