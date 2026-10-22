import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { uuidv7 } from 'uuidv7';
import type { Db } from '@mobilio/db';
import type { MailSender } from '../mail/mail-sender.js';
import type { createRedisSecondaryStorage } from './redis-secondary-storage.js';

export interface BuildAuthDeps {
  db: Db;
  secondaryStorage: ReturnType<typeof createRedisSecondaryStorage>;
  mailSender: MailSender;
  onUserCreated: (userId: string, name: string, email: string) => Promise<void>;
}

/**
 * Pulled out of AuthService as a standalone function (rather than inlined in the
 * constructor) because TypeScript can't name the inferred `betterAuth(...)` return
 * type across two separate generic call sites (`ReturnType<typeof betterAuth>` vs the
 * actual call) without hitting a "$strip from zod/v4/core" portability error — a single
 * function reference sidesteps that, and is more testable besides.
 */
export function buildAuth(deps: BuildAuthDeps) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return betterAuth({
    baseURL: process.env.API_BASE_URL ?? 'http://localhost:3011',
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.WEB_ORIGIN ?? 'http://localhost:3000'],
    database: drizzleAdapter(deps.db, { provider: 'pg', usePlural: true }),
    advanced: {
      // Every id in this repo is UUIDv7 (see packages/db) — including Better Auth's
      // own text-typed user/session/account/verification ids.
      database: { generateId: () => uuidv7() },
    },
    // Shared across api instances (not per-process in-memory), so rate limits on login
    // endpoints actually hold under more than one replica.
    secondaryStorage: deps.secondaryStorage,
    rateLimit: {
      enabled: true,
      storage: 'secondary-storage',
      customRules: {
        '/sign-in/magic-link': { window: 60, max: 5 },
      },
    },
    emailAndPassword: { enabled: false },
    socialProviders:
      googleClientId && googleClientSecret
        ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
        : undefined,
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await deps.onUserCreated(user.id, user.name, user.email);
          },
        },
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await deps.mailSender.send({
            to: email,
            subject: 'Sign in to Mobilio',
            body: `Click to sign in: ${url}`,
          });
        },
      }),
    ],
  });
}
