import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * One compiled base .ipa of apps/shell, built once per version on macOS
 * (.github/workflows/build-shell-base.yml) and reused across every client repack
 * (packages/repacker) — never rebuilt per client. Registered via the internal
 * POST /internal/shell-releases endpoint (SHELL_RELEASE_SECRET-authenticated, no
 * session/org — this table has no tenant concept at all), activated separately and
 * explicitly rather than automatically on upload, so a bad base build never goes live
 * just by finishing CI.
 */
export const shellReleases = pgTable(
  'shell_releases',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    version: text('version').notNull(),
    ipaKey: text('ipa_key').notNull(),
    manifest: jsonb('manifest').notNull(),
    sha256: text('sha256').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('shell_releases_version_unique').on(table.version),
    // Postgres partial-unique idiom: every row matching the WHERE indexes the same
    // constant value (boolean true), so at most one such row can exist — the
    // one-active-release invariant enforced at the database, not just by the
    // activation endpoint's own "deactivate the rest" step.
    uniqueIndex('shell_releases_one_active').on(table.isActive).where(sql`${table.isActive}`),
  ],
);
