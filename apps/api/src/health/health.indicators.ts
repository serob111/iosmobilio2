import { Client } from 'pg';
import { Redis } from 'ioredis';

export type IndicatorResult = { status: 'up' | 'down'; error?: string };

export async function checkPostgres(databaseUrl: string): Promise<IndicatorResult> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', error: error instanceof Error ? error.message : 'unknown error' };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function checkRedis(redisUrl: string): Promise<IndicatorResult> {
  const client = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1 });
  try {
    await client.connect();
    await client.ping();
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', error: error instanceof Error ? error.message : 'unknown error' };
  } finally {
    client.disconnect();
  }
}
