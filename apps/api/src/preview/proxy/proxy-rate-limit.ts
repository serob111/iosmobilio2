import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

const WINDOW_SECONDS = 60;
// A single real page load fans out into many resource requests (html + css + js +
// images + fonts), so this needs to be far more generous than an API-write limit like
// BuildRateLimitService's — the goal here is blunting abuse (scraping, slug-enumeration
// traffic hammering the proxy), not throttling one legitimate page view.
const LIMIT_PER_SLUG = 300;
const LIMIT_PER_IP = 300;

/**
 * Redis-backed fixed-window limit for the preview proxy, keyed independently by slug AND
 * by IP (per the spec: "лимит по slug И по IP") — both must be under their own limit for a
 * request to pass. Two independent keys rather than one combined key because they guard
 * against two different abuse shapes: one IP hammering many different slugs (scraping),
 * or many IPs hammering one slug (a single preview going viral/getting hit by a bot net).
 */
@Injectable()
export class ProxyRateLimitService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  async checkAndIncrement(slug: string, ip: string): Promise<boolean> {
    const [slugCount, ipCount] = await Promise.all([
      this.incrementAndExpire(`proxy-rate-limit:slug:${slug}`),
      this.incrementAndExpire(`proxy-rate-limit:ip:${ip}`),
    ]);
    return slugCount <= LIMIT_PER_SLUG && ipCount <= LIMIT_PER_IP;
  }

  private async incrementAndExpire(key: string): Promise<number> {
    const count = await this.redis.incr(key);
    await this.redis.expire(key, WINDOW_SECONDS, 'NX');
    return count;
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
