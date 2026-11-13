import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { FakeRunner } from './fake-runner.js';

/**
 * Test-only: an out-of-process e2e test (a real browser driving a real apps/api, not
 * an in-process NestJS TestingModule with direct access to `app.get(FakeRunner)` like
 * builds.integration.spec.ts has) has no other way to read back the raw build token
 * createBuild() dispatched — it's deliberately never returned to the client (see
 * BuildsController.create) — so it can play the runner's part itself (POST
 * /builds/:id/start, etc., see fake-runner.ts). BuildsModule only registers this
 * controller at all when BUILD_RUNNER=fake — nothing to gate here once that's true.
 */
@Controller('_test/fake-runner')
export class FakeRunnerController {
  constructor(private readonly fakeRunner: FakeRunner) {}

  @Get('dispatched')
  @Public()
  list(): Array<{ id: string; token: string; baseUrl: string }> {
    return this.fakeRunner.dispatched;
  }
}
