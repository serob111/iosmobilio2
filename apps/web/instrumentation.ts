import * as Sentry from '@sentry/nextjs';

// We only run on the Node.js runtime (no edge functions in this app), so this just
// conditionally loads the guarded server config — see sentry.server.config.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
