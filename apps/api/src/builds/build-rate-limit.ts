import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

const WINDOW_SECONDS = 60 * 60;
const LIMIT = 10;

/**
 * Redis-backed fixed-window build-dispatch limit, keyed by org (not IP — the caller is
 * always an authenticated org member here, and the thing worth rate-limiting is how many
 * CI minutes/dispatches one org can burn through, not which browser asked). Same
 * INCR + EXPIRE...NX shape as DraftRateLimitService — see that file for why NX matters.
 */
@Injectable()
export class BuildRateLimitService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  async checkAndIncrement(orgId: string): Promise<boolean> {
    const key = `build-rate-limit:${orgId}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, WINDOW_SECONDS, 'NX');
    return count <= LIMIT;
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
