import { CanActivate, Injectable, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { runInTokenLookupContext, getTenantDb, schema, eq } from '@mobilio/db';
import type { ProjectConfig } from '@mobilio/config';
import type { Request } from 'express';
import { DbService } from '../db/db.service.js';
import { hashDraftToken, readDraftCookie } from './draft-token.js';
import './draft.types.js';

/**
 * Guards the @Public() /drafts/me* routes — identity comes entirely from the claim-token
 * cookie, never a session. Treats an already-expired draft as not found even though
 * drafts_token_access (the RLS policy this runs under) doesn't itself check expiry — only
 * drafts_delete_expired and the worker's hourly sweep do that, on their own schedule. Without
 * this check, a client could keep reading/writing a draft past its stated 7-day lifetime
 * for as long as the sweep happens to be running late.
 */
@Injectable()
export class DraftGuard implements CanActivate {
  constructor(private readonly dbService: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawToken = readDraftCookie(request);
    if (!rawToken) {
      throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found' });
    }
    const tokenHash = hashDraftToken(rawToken);

    const draft = await runInTokenLookupContext(this.dbService.db, tokenHash, async () => {
      const [row] = await getTenantDb().select().from(schema.drafts).where(eq(schema.drafts.tokenHash, tokenHash));
      return row;
    });

    if (!draft || draft.expiresAt < new Date()) {
      throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found' });
    }

    request.draft = {
      id: draft.id,
      name: draft.name,
      sourceUrl: draft.sourceUrl,
      config: draft.config as ProjectConfig,
      configVersion: draft.configVersion,
      expiresAt: draft.expiresAt,
    };
    request.draftTokenHash = tokenHash;
    return true;
  }
}
