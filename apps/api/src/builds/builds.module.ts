import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { BuildsController } from './builds.controller.js';
import { BuildRunnerController } from './build-runner.controller.js';
import { FakeRunnerController } from './fake-runner.controller.js';
import { BuildsService } from './builds.service.js';
import { BuildRunnerGuard } from './build-runner.guard.js';
import { BuildRateLimitService } from './build-rate-limit.js';
import { BUILD_RUNNER } from './build-runner.js';
import { GithubActionsRunner } from './github-actions-runner.js';
import { FakeRunner } from './fake-runner.js';

// Read once, at module-definition time (this file's own import, same timing as
// validateBuildEnv() at bootstrap) — not re-evaluated per request. FakeRunnerController
// (/_test/fake-runner/dispatched) is a test-only escape hatch for out-of-process e2e
// tests (see its own doc comment) with nothing to do on a real deployment; rather than
// register the route unconditionally and gate its *behavior* internally, it's simply
// never registered at all when BUILD_RUNNER isn't "fake" — Nest's router then 404s on
// that path the same way it would for any other route that doesn't exist, with no
// controller code path to audit for a real deployment at all.
const controllers =
  process.env.BUILD_RUNNER === 'fake'
    ? [BuildsController, BuildRunnerController, FakeRunnerController]
    : [BuildsController, BuildRunnerController];

@Module({
  imports: [OrganizationsModule, ProjectsModule],
  controllers,
  providers: [
    BuildsService,
    BuildRunnerGuard,
    BuildRateLimitService,
    GithubActionsRunner,
    FakeRunner,
    {
      // Both runners are always instantiated (cheap — neither does anything in its
      // constructor); BUILD_RUNNER=fake picks FakeRunner, otherwise GithubActionsRunner.
      // Injecting FakeRunner itself (not just resolving BUILD_RUNNER) is how a test gets
      // at the exact same instance createBuild dispatched through, to read the raw token
      // back out of `dispatched` and drive the runner endpoints itself.
      provide: BUILD_RUNNER,
      useFactory: (github: GithubActionsRunner, fake: FakeRunner) =>
        process.env.BUILD_RUNNER === 'fake' ? fake : github,
      inject: [GithubActionsRunner, FakeRunner],
    },
  ],
  exports: [FakeRunner],
})
export class BuildsModule {}
