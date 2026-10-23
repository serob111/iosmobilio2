import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Request } from 'express';

const WINDOW_SECONDS = 10 * 60;
const LIMIT = 10;

export function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return 'unknown';
}

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

  async checkAndIncrement(ip: string): Promise<boolean> {
    const key = `draft-rate-limit:${ip}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, WINDOW_SECONDS, 'NX');
    return count <= LIMIT;
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
