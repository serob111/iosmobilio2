import { Injectable } from '@nestjs/common';
import { QueueService } from '../queue/queue.service.js';
import type { BuildRunner } from './build-runner.js';

/**
 * Dispatches an 'adhoc' build by enqueueing a BullMQ job for apps/worker to process
 * end-to-end — download the active shell_releases base.ipa, ensureBundleId/
 * ensureAdHocProfile, repack(), upload the result, generate manifest.plist — entirely
 * in-process in the worker, with direct DB access. Never calls back into this API over
 * HTTP, unlike GithubActionsRunner. `token`/`baseUrl` exist on BuildRunner's shared
 * dispatch() signature purely for GithubActionsRunner's callback-token flow; this
 * implementation ignores both and only needs the build's own id.
 */
@Injectable()
export class RepackRunner implements BuildRunner {
  constructor(private readonly queueService: QueueService) {}

  async dispatch(build: { id: string; token: string; baseUrl: string }): Promise<void> {
    await this.queueService.enqueueRepack(build.id);
  }
}
