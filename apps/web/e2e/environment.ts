function readRedisDatabase(): number {
  const raw = process.env.E2E_REDIS_DB ?? '0';
  const database = Number(raw);
  if (!Number.isSafeInteger(database) || database < 0) {
    throw new Error('E2E_REDIS_DB must be a non-negative integer');
  }
  return database;
}

export const E2E_REDIS_DATABASE = readRedisDatabase();

export function getE2ERedisUrl(): string {
  const redisUrl = new URL(process.env.E2E_API_REDIS_URL ?? 'redis://localhost:6380');
  if (redisUrl.protocol !== 'redis:' && redisUrl.protocol !== 'rediss:') {
    throw new Error('E2E_API_REDIS_URL must use redis:// or rediss://');
  }
  redisUrl.pathname = `/${E2E_REDIS_DATABASE}`;
  return redisUrl.toString();
}
