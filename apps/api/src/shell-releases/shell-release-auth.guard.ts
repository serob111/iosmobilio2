import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, Injectable, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

const BEARER_PREFIX = 'Bearer ';

function hash(value: string): Buffer {
  return Buffer.from(createHash('sha256').update(value).digest('hex'));
}

/**
 * Authenticates the one legitimate caller of /internal/shell-releases —
 * .github/workflows/build-shell-base.yml — against a single static shared secret
 * (SHELL_RELEASE_SECRET), not a session and not a per-row token like
 * BuildRunnerGuard's: there's exactly one caller, not many concurrent builds each
 * needing their own token. Both sides are hashed to the same fixed length before
 * timingSafeEqual (same reasoning as hashBuildToken's comparison in
 * build-runner.guard.ts) — raw values of different lengths would otherwise throw
 * instead of comparing, and the comparison itself would leak length via that throw.
 */
@Injectable()
export class ShellReleaseAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const provided = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;
    const expected = process.env.SHELL_RELEASE_SECRET;

    if (!expected || !provided || !timingSafeEqual(hash(provided), hash(expected))) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    return true;
  }
}
