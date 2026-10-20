import * as Sentry from '@sentry/nextjs';

// Guarded: a missing DSN makes this a clean no-op, not a crash. Client-side DSN must be
// NEXT_PUBLIC_-prefixed to reach the browser bundle.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
