import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { DraftsController } from './drafts.controller.js';
import { DraftClaimController } from './draft-claim.controller.js';
import { DraftsService } from './drafts.service.js';
import { DraftGuard } from './draft.guard.js';
import { DraftRateLimitService } from './draft-rate-limit.js';

@Module({
  imports: [OrganizationsModule],
  controllers: [DraftsController, DraftClaimController],
  providers: [DraftsService, DraftGuard, DraftRateLimitService],
  // DraftGuard is exported so other modules whose routes nest under /drafts/me (like
  // PreviewModule) can reuse it via @UseGuards(DraftGuard) instead of re-implementing
  // the same claim-token lookup.
  exports: [DraftGuard],
})
export class DraftsModule {}
