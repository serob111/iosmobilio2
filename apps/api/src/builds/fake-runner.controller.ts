import { Controller, Get, NotFoundException } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { FakeRunner } from './fake-runner.js';

/**
 * Test-only: an out-of-process e2e test (a real browser driving a real apps/api, not
 * an in-process NestJS TestingModule with direct access to `app.get(FakeRunner)` like
 * builds.integration.spec.ts has) has no other way to read back the raw build token
 * createBuild() dispatched — it's deliberately never returned to the client (see
 * BuildsController.create) — so it can play the runner's part itself (POST
 * /builds/:id/start, etc., see fake-runner.ts). Gated on BUILD_RUNNER=fake itself,
 * which validateBuildEnv() already refuses when NODE_ENV=production, so this route
 * can never do anything on a real deployment even though it's always registered.
 */
@Controller('_test/fake-runner')
export class FakeRunnerController {
  constructor(private readonly fakeRunner: FakeRunner) {}

  @Get('dispatched')
  @Public()
  list(): Array<{ id: string; token: string; baseUrl: string }> {
    if (process.env.BUILD_RUNNER !== 'fake') {
      throw new NotFoundException();
    }
    return this.fakeRunner.dispatched;
  }
}
