import { Controller, NotFoundException, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OrgGuard } from '../organizations/org.guard.js';
import { DraftsService } from './drafts.service.js';
import { clearDraftCookie, readDraftCookie } from './draft-token.js';
import '../auth/auth.types.js';
import '../tenant/tenant.types.js';

/**
 * Deliberately under /orgs/:orgId (not /drafts/claim) — claiming requires OrgGuard's
 * membership check, since the draft is moving INTO this org. The claim token comes from
 * the same httpOnly cookie the original, anonymous POST /drafts call set — nothing the
 * caller needs to read or pass along by hand, it just rides along once the browser signs in.
 */
@Controller('orgs/:orgId/drafts')
export class DraftClaimController {
  constructor(private readonly draftsService: DraftsService) {}

  @Post('claim')
  @UseGuards(OrgGuard)
  async claim(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const rawToken = readDraftCookie(request);
    if (!rawToken) {
      throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found' });
    }
    const result = await this.draftsService.claimDraft(request.tenant!.orgId, request.tenant!.userId, rawToken);
    clearDraftCookie(response);
    return result;
  }
}
