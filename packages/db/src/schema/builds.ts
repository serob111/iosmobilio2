import { relations, sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { organizations } from './tenant';
import { projects } from './projects';

export const buildStatus = pgEnum('build_status', ['queued', 'building', 'done', 'failed']);

/**
 * token_hash/token_expires_at identify the one-off bearer token the build runner
 * (GitHub Actions today, a template-repack step later) uses to call back into the api
 * for this specific build — see builds_token_select/builds_token_update in
 * 0008_builds_token_access.sql. Cleared to NULL once the build leaves queued/building
 * (done or failed), so the token stops working the moment it's no longer needed, even
 * before its 2h TTL expires.
 */
export const builds = pgTable(
  'builds',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: buildStatus('status').notNull().default('queued'),
    // GitHub Actions run id/url — unknown until the workflow is actually dispatched.
    runId: integer('run_id'),
    runUrl: text('run_url'),
    error: text('error'),
    // Which apps/shell template commit/version this build ran against.
    templateVersion: text('template_version'),
    tokenHash: text('token_hash'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // Object storage key of the produced .ipa once uploaded (packages/storage's buildIpaKey).
    ipaKey: text('ipa_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('builds_org_id_idx').on(table.orgId),
    index('builds_project_id_idx').on(table.projectId),
    // At most one queued/building build per project at a time — the app layer checks
    // this before dispatching too, but the real guarantee against a concurrent-request
    // race is this index: a second INSERT that would violate it fails at the database,
    // which BuildsService.createBuild catches and turns into 409 BUILD_IN_PROGRESS.
    uniqueIndex('builds_one_active_per_project')
      .on(table.projectId)
      .where(sql`${table.status} IN ('queued', 'building')`),
  ],
);

export const buildsRelations = relations(builds, ({ one }) => ({
  organization: one(organizations, { fields: [builds.orgId], references: [organizations.id] }),
  project: one(projects, { fields: [builds.projectId], references: [projects.id] }),
}));
