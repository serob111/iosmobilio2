import { relations, sql } from 'drizzle-orm';
import { pgTable, uuid, text, bigint, timestamp, pgEnum, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { organizations } from './tenant';
import { projects } from './projects';

export const buildStatus = pgEnum('build_status', ['queued', 'building', 'done', 'failed']);
// 'adhoc' is the fast Linux-worker repack path (packages/repacker + packages/apple) —
// the actual point of this whole feature, and what every build created through the
// editor's "Build .ipa" button gets today. 'appstore' is the existing full-macOS-
// compile-via-GitHub-Actions path, kept for the future real App Store pipeline (Apple
// requires a compiled Assets.car for icons, which a Linux repack can't produce) — not
// reachable from the UI yet (see builds.service.ts's createBuild, which always passes
// 'adhoc'; nothing currently calls it with 'appstore').
export const buildKind = pgEnum('build_kind', ['adhoc', 'appstore']);

/**
 * token_hash/token_expires_at identify the one-off bearer token the build runner
 * (GitHub Actions today, a template-repack step later) uses to call back into the api
 * for this specific build — see builds_token_select/builds_token_update in
 * 0008_builds_token_access.sql. Cleared to NULL once the build leaves queued/building
 * (done or failed), so the token stops working the moment it's no longer needed, even
 * before its 2h TTL expires. Only meaningful for 'appstore' kind (GitHub Actions calls
 * back over HTTP); 'adhoc'/repack builds run in-process in the worker with direct DB
 * access and never use this token at all.
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
    kind: buildKind('kind').notNull().default('adhoc'),
    status: buildStatus('status').notNull().default('queued'),
    // GitHub Actions run id/url — unknown until the workflow is actually dispatched.
    // bigint, not integer: GitHub's run ids have long since exceeded int4's ~2.1 billion
    // ceiling (e.g. 43268190556). mode: 'number' (not 'bigint'/JS BigInt) is safe — run
    // ids are comfortably within Number.MAX_SAFE_INTEGER — and keeps runId a plain
    // number everywhere it's already used (BuildSummary, JSON responses) with no
    // BigInt-serialization ripple effects.
    runId: bigint('run_id', { mode: 'number' }),
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
    // Per-step duration, in the exact shape packages/repacker's own repack() already
    // returns (RepackStepTiming[] = {step, durationMs}[]) — the worker's repack job
    // appends its own steps (download, ensureBundleId, ensureAdHocProfile, upload,
    // manifest) to that same array rather than inventing a second timing format. NULL
    // until a repack build actually runs (and always NULL for 'appstore' kind, which
    // has no equivalent per-step breakdown from GitHub Actions).
    stepTimings: jsonb('step_timings'),
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
