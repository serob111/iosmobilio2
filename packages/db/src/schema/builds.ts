import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { organizations } from './tenant';
import { projects } from './projects';

export const buildStatus = pgEnum('build_status', ['queued', 'building', 'done', 'failed']);

/**
 * Empty for now — not read or written by any app code yet (the builds module itself is
 * a later stage). Scaffolded here, same as `projects` was in Этап 1, so its RLS policy
 * and the org_id-isolation shape ship ahead of the module that will actually use it.
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
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // Object storage key of the produced .ipa once uploaded (packages/storage's buildIpaKey).
    ipaKey: text('ipa_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('builds_org_id_idx').on(table.orgId), index('builds_project_id_idx').on(table.projectId)],
);

export const buildsRelations = relations(builds, ({ one }) => ({
  organization: one(organizations, { fields: [builds.orgId], references: [organizations.id] }),
  project: one(projects, { fields: [builds.projectId], references: [projects.id] }),
}));
