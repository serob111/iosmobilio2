import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

const WINDOW_SECONDS = 60;
const LIMIT = 60;

/**
 * Redis-backed fixed-window IP rate limit for GET /preview/:slug — a read of mostly-
 * static metadata (name/theme/tabs/icon URL), not a write, so this is generous (60/min)
 * compared to drafts creation: its purpose isn't to throttle legitimate use (a device
 * polling its own preview, a page re-rendering the tab bar) but to blunt slug-enumeration
 * attempts against the 22-char base64url space, where the real defense is the slug's own
 * entropy, this is just a speed bump on top.
 */
@Injectable()
export class PreviewRateLimitService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  async checkAndIncrement(key: string): Promise<boolean> {
    const redisKey = `preview-rate-limit:${key}`;
    const count = await this.redis.incr(redisKey);
    await this.redis.expire(redisKey, WINDOW_SECONDS, 'NX');
    return count <= LIMIT;
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
