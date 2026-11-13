import { timingSafeEqual } from 'node:crypto';
import { CanActivate, Injectable, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { runInBuildContext } from '@mobilio/db';
import type { Request } from 'express';
import { DbService } from '../db/db.service.js';
import { hashBuildToken } from './build-token.js';
import './build.types.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * Guards the @Public() /builds/:id/* runner endpoints — identity comes entirely from the
 * `Authorization: Bearer <buildToken>` header, never a session. Not found, expired, and
 * wrong-status all collapse into the exact same 404 BUILD_NOT_FOUND (no distinguishing
 * response), same reasoning as DraftGuard: nothing here should let a caller learn
 * anything about a build it doesn't already hold a live token for.
 */
@Injectable()
export class BuildRunnerGuard implements CanActivate {
  constructor(private readonly dbService: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const rawToken = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;
    if (!rawToken) {
      throw new NotFoundException({ code: 'BUILD_NOT_FOUND', message: 'Build not found' });
    }
    const tokenHash = hashBuildToken(rawToken);

    const build = await runInBuildContext(this.dbService.db, tokenHash, async (row) => row);

    // The RLS lookup above already matched on token_hash equality — this is a defense in
    // depth, explicit constant-time re-check rather than trusting that match alone, in
    // case some future change to the lookup query ever makes the DB-side comparison less
    // strict than it looks here.
    if (!build?.tokenHash || !timingSafeEqual(Buffer.from(build.tokenHash), Buffer.from(tokenHash))) {
      throw new NotFoundException({ code: 'BUILD_NOT_FOUND', message: 'Build not found' });
    }

    request.build = build;
    request.buildTokenHash = tokenHash;
    return true;
  }
}
