import { pgTable, uuid, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Anonymous, pre-signup projects (Этап 2's free preview-without-registration flow) — no
 * org_id, no user_id. Access control isn't org-based at all: it's "whoever presents the
 * matching claim token" (see packages/db/migrations' RLS policy and
 * runInTokenLookupContext), the same mechanism invitations already use for "find by raw
 * token before any org is known".
 */
export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    name: text('name').notNull(),
    sourceUrl: text('source_url').notNull(),
    config: jsonb('config').notNull(),
    configVersion: integer('config_version').notNull().default(1),
    // SHA-256 hex of the raw claim token — same convention as invitations.token_hash:
    // only the hash is persisted, the raw token lives solely in the httpOnly cookie.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  // Powers the worker's hourly "delete everything past expiry" sweep — a plain
  // WHERE expires_at < now() with no other predicate, so this is the only index it needs.
  (table) => [index('drafts_expires_at_idx').on(table.expiresAt)],
);
