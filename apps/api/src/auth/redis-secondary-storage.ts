import type { Redis } from 'ioredis';

/**
 * Better Auth's SecondaryStorage interface (get/getAndDelete/increment/set/delete),
 * backed by the same Redis instance used elsewhere in apps/api. Used for rate limiting
 * (see auth.service.ts's `rateLimit.storage: 'secondary-storage'`) so limits are shared
 * across api instances instead of reset per-process.
 */
export function createRedisSecondaryStorage(connection: Redis) {
  return {
    get: (key: string) => connection.get(key),
    getAndDelete: async (key: string) => {
      const value = await connection.get(key);
      if (value !== null) {
        await connection.del(key);
      }
      return value;
    },
    increment: async (key: string, ttl: number) => {
      const value = await connection.incr(key);
      if (value === 1) {
        await connection.expire(key, ttl);
      }
      return value;
    },
    set: async (key: string, value: string, ttl?: number) => {
      if (ttl) {
        await connection.set(key, value, 'EX', ttl);
      } else {
        await connection.set(key, value);
      }
    },
    delete: async (key: string) => {
      await connection.del(key);
    },
  };
}
