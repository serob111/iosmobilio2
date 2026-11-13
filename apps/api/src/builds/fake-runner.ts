import { Injectable } from '@nestjs/common';
import type { BuildRunner } from './build-runner.js';

/**
 * BUILD_RUNNER=fake — used in tests and local dev so createBuild doesn't try to call the
 * real GitHub API. Records every dispatch instead of acting on it; a live e2e test plays
 * the runner's part itself by reading the raw token back out of `dispatched` and driving
 * the actual runner-facing endpoints (POST /builds/:id/start, etc.) directly.
 */
@Injectable()
export class FakeRunner implements BuildRunner {
  readonly dispatched: Array<{ id: string; token: string; baseUrl: string }> = [];

  async dispatch(build: { id: string; token: string; baseUrl: string }): Promise<void> {
    this.dispatched.push(build);
  }
}
