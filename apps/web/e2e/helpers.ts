import { existsSync, readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import { MAIL_LOG_FILE } from './mailLog';

export interface LoggedMail {
  to: string;
  subject: string;
  body: string;
}

export function readMailLines(): string[] {
  if (!existsSync(MAIL_LOG_FILE)) return [];
  return readFileSync(MAIL_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
}

/**
 * Only matches lines appended after `sinceLine` — without this, re-signing in with the
 * same email (e.g. a register-then-login-again test) can match the *first* sign-in's
 * already-consumed magic-link token instead of the second one, since both share the
 * same `to` address and the file is append-only across the whole test run.
 */
export async function waitForMail(to: string, bodyIncludes: string, sinceLine: number, timeoutMs = 10_000): Promise<LoggedMail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = readMailLines();
    const match = lines
      .slice(sinceLine)
      .map((line) => JSON.parse(line) as LoggedMail)
      .find((m) => m.to === to && m.body.includes(bodyIncludes));
    if (match) return match;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for mail to ${to} containing "${bodyIncludes}"`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export function extractUrl(body: string): string {
  const [url] = body.match(/https?:\/\/\S+/) ?? [];
  if (!url) throw new Error(`No URL found in mail body: ${body}`);
  return url;
}

function redisClient(): Redis {
  const redisUrl = process.env.E2E_API_REDIS_URL ?? 'redis://localhost:6380';
  return new Redis(redisUrl);
}

// Rate-limit buckets are keyed "<client-ip>|<path>" and shared across the whole Redis
// instance; a suite with multiple sign-ins accumulates toward them fast enough to trip
// a limit within a single test otherwise. The ip prefix isn't fixed — it depends on how
// the request reaches apps/api — so this matches by suffix rather than hardcoding one.
// A targeted delete, not flushdb: this same Redis also holds active sessions and
// in-flight magic-link tokens (Better Auth's secondaryStorage), and a full flush risks
// wiping a different, still-valid session.
export async function resetRateLimitBuckets(): Promise<void> {
  const redis = redisClient();
  const keys = await redis.keys('*|/sign-in/magic-link');
  keys.push(...(await redis.keys('*|/magic-link/verify')));
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  await redis.quit();
}
