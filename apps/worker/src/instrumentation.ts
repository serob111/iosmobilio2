import * as Sentry from '@sentry/node';

// Guarded: a missing SENTRY_DSN makes this a clean no-op, not a crash.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}
