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
})
export class DraftsModule {}
