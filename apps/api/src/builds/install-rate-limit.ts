import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

const WINDOW_SECONDS = 60;
const LIMIT = 60;

/**
 * Redis-backed fixed-window IP rate limit for the public install endpoints
 * (manifest.plist / install.ipa) — mirrors PreviewRateLimitService exactly (same
 * window/limit, same "the real defense is the three chained UUIDs' own entropy, this
 * is just a speed bump on top of that" reasoning), kept as its own service rather than
 * reused since builds and previews are different concerns with no reason to share a
 * Redis key namespace or a lifecycle.
 */
@Injectable()
export class InstallRateLimitService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  async checkAndIncrement(key: string): Promise<boolean> {
    const redisKey = `install-rate-limit:${key}`;
    const count = await this.redis.incr(redisKey);
    await this.redis.expire(redisKey, WINDOW_SECONDS, 'NX');
    return count <= LIMIT;
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
