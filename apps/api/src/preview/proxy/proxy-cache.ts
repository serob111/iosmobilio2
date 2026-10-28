import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

const TTL_SECONDS = 5 * 60;
const MAX_CACHEABLE_BYTES = 2 * 1024 * 1024;

export type CachedProxyResponse = {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
};

/**
 * Redis-backed response cache for the preview proxy, keyed by slug + path + query (so two
 * different preview links to two different sites/drafts never share a cache entry, even
 * if their paths happen to coincide). Only successful, small responses are worth caching —
 * a non-200 (error page, 304, redirect-turned-interstitial) or a >2MB body (already at the
 * edge of what this proxy will even stream) isn't, so `set` silently no-ops for those
 * instead of the caller needing to decide upfront.
 */
@Injectable()
export class ProxyCacheService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  private cacheKey(slug: string, path: string, query: string): string {
    return `proxy-cache:${slug}:${path}${query ? `?${query}` : ''}`;
  }

  async get(slug: string, path: string, query: string): Promise<CachedProxyResponse | null> {
    const raw = await this.redis.get(this.cacheKey(slug, path, query));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as CachedProxyResponse;
    } catch {
      return null;
    }
  }

  async set(
    slug: string,
    path: string,
    query: string,
    status: number,
    headers: Record<string, string>,
    body: Buffer,
  ): Promise<void> {
    if (status !== 200 || body.length > MAX_CACHEABLE_BYTES) {
      return;
    }
    const entry: CachedProxyResponse = { status, headers, bodyBase64: body.toString('base64') };
    await this.redis.set(this.cacheKey(slug, path, query), JSON.stringify(entry), 'EX', TTL_SECONDS);
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
