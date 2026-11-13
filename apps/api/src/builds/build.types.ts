import type { schema } from '@mobilio/db';

export type BuildRow = (typeof schema.builds.$inferSelect);

declare module 'express' {
  interface Request {
    /** Set by BuildRunnerGuard once it has verified the bearer token against a live build. */
    build?: BuildRow;
    buildTokenHash?: string;
  }
}
