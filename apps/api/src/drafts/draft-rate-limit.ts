import { BadRequestException, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Request } from 'express';

const WINDOW_SECONDS = 10 * 60;
const LIMIT = 10;

function expandIpv6Groups(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  if (!ip.includes('::')) {
    return headGroups;
  }
  const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
  const zeroCount = Math.max(8 - headGroups.length - tailGroups.length, 0);
  return [...headGroups, ...Array(zeroCount).fill('0'), ...tailGroups];
}

/**
 * IPv6 clients commonly rotate through many addresses within the same /64 (SLAAC privacy
 * extensions, or simply a provider-assigned /64 per customer) — keying by the full
 * address would hand out a fresh rate-limit budget on every request. IPv4 has no such
 * rotation, so it's keyed by the exact address.
 */
function rateLimitKeyForIp(ip: string): string {
  const ipv4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (ipv4Mapped) {
    return ipv4Mapped[1]!;
  }
  if (!ip.includes(':')) {
    return ip;
  }
  return `${expandIpv6Groups(ip).slice(0, 4).join(':')}::/64`;
}

/**
 * request.ip is Express's own trust-proxy-aware resolution (see create-app.ts's
 * app.set('trust proxy', ...)) — never read X-Forwarded-For directly here, or a client
 * can simply send a different fake value on every request and dodge the limit entirely.
 */
export function getClientRateLimitKey(request: Request): string {
  if (!request.ip) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Could not determine client IP' });
  }
  return rateLimitKeyForIp(request.ip);
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
