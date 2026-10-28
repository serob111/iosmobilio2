import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

const WINDOW_SECONDS = 10 * 60;
const LIMIT = 10;

/**
 * Redis-backed fixed-window IP rate limit for anonymous draft creation (10 per 10
 * minutes — same numbers as apps/web's old in-memory checkRateLimit), so the limit holds
 * across api process restarts/instances rather than resetting per-process.
 *
 * INCR then EXPIRE ... NX (not a plain EXPIRE) matters: EXPIRE NX only arms a TTL on a
 * key that doesn't already have one, so calling it after every INCR is safe to do
 * unconditionally — concurrent requests racing the first INCR of a window can't
 * repeatedly push the window's end back, and a crash between INCR and EXPIRE just means
 * the next request's EXPIRE NX call still arms it instead of leaving the key stuck
 * without a TTL forever.
 */
@Injectable()
export class DraftRateLimitService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  async checkAndIncrement(key: string): Promise<boolean> {
    const redisKey = `draft-rate-limit:${key}`;
    const count = await this.redis.incr(redisKey);
    await this.redis.expire(redisKey, WINDOW_SECONDS, 'NX');
    return count <= LIMIT;
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
