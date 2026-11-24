import { AsyncLocalStorage } from 'node:async_hooks';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { builds } from './schema/builds';
import { previewLinks } from './schema/preview-links';

export interface TenantIdentity {
  orgId: string;
  userId: string;
}

const storage = new AsyncLocalStorage<Db>();

/**
 * The only sanctioned way to touch org_id-scoped tables. Opens a transaction, sets
 * `app.org_id`/`app.user_id` for the lifetime of that transaction via `set_config(...,
 * true)` (SET LOCAL semantics) bound as a real query parameter — never string-
 * interpolated into SQL — then runs `fn` with the scoped connection stashed in
 * AsyncLocalStorage so nested repository calls can reach it via `getTenantDb()`
 * without having it threaded through every function signature. RLS policies
 * (packages/db/migrations) read those two settings to decide what's visible; this
 * function is what makes them non-empty.
 */
export async function runInTenantContext<T>(
  db: Db,
  identity: TenantIdentity,
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.org_id', ${identity.orgId}, true)`);
    await scoped.execute(sql`select set_config('app.user_id', ${identity.userId}, true)`);
    return storage.run(scoped, fn);
  });
}

/**
 * For cross-org reads of a user's own rows (e.g. "which orgs am I in" for GET /me) —
 * sets only app.user_id, leaving app.org_id unset. Relies on a second, SELECT-only RLS
 * policy on `memberships` (packages/db/migrations/0001_rls.sql) that permits a row when
 * its user_id matches, independent of org_id; INSERT/UPDATE/DELETE stay governed by the
 * strict org-matching policy only, so this cannot be used to write across orgs.
 */
export async function runInUserContext<T>(db: Db, userId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return storage.run(scoped, fn);
  });
}

/**
 * For looking up a single invitation by its raw token before its org is known (e.g.
 * accepting an invite) — sets only app.lookup_token_hash, leaving app.org_id unset.
 * Relies on a SELECT-only RLS policy on `invitations` matching on token_hash; safe
 * because token_hash is a SHA-256 hash of a random, unguessable token, so presenting
 * the right value already proves the right to read that one row.
 */
export async function runInTokenLookupContext<T>(db: Db, tokenHash: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.lookup_token_hash', ${tokenHash}, true)`);
    return storage.run(scoped, fn);
  });
}

/**
 * For claiming a draft into an org (packages/db/migrations' drafts RLS policy) — the
 * move (insert into `projects`, delete from `drafts`) has to be one atomic transaction,
 * and each table's RLS policy reads a different setting (projects: app.org_id; drafts:
 * app.lookup_token_hash). Setting all three in the same transaction, rather than nesting
 * two separate `runInTenantContext`/`runInTokenLookupContext` transactions, is what
 * makes both tables' writes commit-or-rollback together.
 */
export async function runInClaimContext<T>(
  db: Db,
  params: { orgId: string; userId: string; tokenHash: string },
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.org_id', ${params.orgId}, true)`);
    await scoped.execute(sql`select set_config('app.user_id', ${params.userId}, true)`);
    await scoped.execute(sql`select set_config('app.lookup_token_hash', ${params.tokenHash}, true)`);
    return storage.run(scoped, fn);
  });
}

/**
 * For the build runner's token-authenticated callbacks (POST /builds/:id/start, GET
 * .../config, GET .../icon, POST .../ipa, POST .../fail) — looks the build up by its
 * token hash first (builds_token_select/update, see 0009_builds_token_access.sql, cover
 * only a live queued/building row), then, once its project is known, sets
 * app.build_project_id — NOT app.org_id — so the same transaction can also read that one
 * project (icon/config) under projects_build_runner_select (0010_builds_runner_project_scope.sql).
 * Deliberately narrower than runInTenantContext: the runner has no user identity and no
 * legitimate reason to see any OTHER project, build, membership, or invitation in the
 * same org — setting app.org_id here would have handed it org-wide read access via
 * projects_org_isolation, far more than it needs. Returns undefined (instead of
 * throwing) when no row matches, so callers 404 uniformly rather than distinguishing "no
 * such token" from "found but already done".
 */
export async function runInBuildContext<T>(
  db: Db,
  tokenHash: string,
  fn: (build: typeof builds.$inferSelect) => Promise<T>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.lookup_token_hash', ${tokenHash}, true)`);
    const [build] = await scoped.select().from(builds).where(eq(builds.tokenHash, tokenHash));
    if (!build) {
      return undefined;
    }
    await scoped.execute(sql`select set_config('app.build_project_id', ${build.projectId}, true)`);
    return storage.run(scoped, () => fn(build));
  });
}

/**
 * For the public, unauthenticated GET /preview/:slug reader — no session, no draft
 * cookie, just the slug's own hash. Looks the link up by slug_hash first
 * (preview_links_slug_lookup, see 0014_preview_links_rls.sql, covers only a live
 * not-revoked/not-expired row), then, once its owner is known, sets EITHER
 * app.preview_project_id OR app.preview_draft_id — never app.org_id or
 * app.lookup_token_hash, since this caller was never a member or a draft owner — so the
 * same transaction can also read that one project or draft under
 * projects_preview_select/drafts_preview_select. Returns undefined when no row matches,
 * so the controller 404s uniformly rather than distinguishing "no such slug" from
 * "revoked" from "expired".
 */
export async function runInPreviewLookupContext<T>(
  db: Db,
  slugHash: string,
  fn: (link: typeof previewLinks.$inferSelect) => Promise<T>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.lookup_slug_hash', ${slugHash}, true)`);
    const [link] = await scoped.select().from(previewLinks).where(eq(previewLinks.slugHash, slugHash));
    if (!link) {
      return undefined;
    }
    if (link.projectId) {
      await scoped.execute(sql`select set_config('app.preview_project_id', ${link.projectId}, true)`);
    } else {
      await scoped.execute(sql`select set_config('app.preview_draft_id', ${link.draftId}, true)`);
    }
    return storage.run(scoped, () => fn(link));
  });
}

/**
 * For the repack worker job (apps/worker) — it receives only a raw build id (a BullMQ
 * job payload, {buildId}), with no session, no org identity, and no per-build secret
 * token the way the GitHub Actions runner's HTTP callback flow has (an in-process
 * worker job never calls back over HTTP at all, so there's nothing to hand it a token
 * for). Looks the build up by id first (builds_worker_access,
 * see 0025_worker_build_access.sql), then, once its project is known, sets
 * app.worker_build_project_id so the same transaction can also read/write that one
 * project's provisioning_profiles row under provisioning_profiles_worker_access.
 * Deliberately narrower than runInTenantContext: never sets app.org_id, so this cannot
 * reach memberships/invitations/other projects in the same org. Trust here is
 * structural, not a secret: no HTTP-request-driven code path ever sets either GUC, so a
 * build id alone is never enough for an ordinary request to reach these policies — same
 * trust category as builds_watchdog's SECURITY DEFINER sweep, just scoped to one build.
 * Returns undefined when no row matches, so the job can fail cleanly rather than crash
 * on a build that somehow no longer exists.
 */
export async function runInWorkerBuildContext<T>(
  db: Db,
  buildId: string,
  fn: (build: typeof builds.$inferSelect) => Promise<T>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.worker_build_id', ${buildId}, true)`);
    const [build] = await scoped.select().from(builds).where(eq(builds.id, buildId));
    if (!build) {
      return undefined;
    }
    await scoped.execute(sql`select set_config('app.worker_build_project_id', ${build.projectId}, true)`);
    return storage.run(scoped, () => fn(build));
  });
}

/**
 * For the public, unauthenticated install endpoint (apps/api) — an iOS device fetching
 * an itms-services manifest.plist or the .ipa itself has no session/cookies, only the
 * three ids already in its own URL path. Looks the build up by raw id
 * (builds_install_select, see 0028_builds_install_select.sql) — SELECT only, never
 * UPDATE, unlike runInWorkerBuildContext's app.worker_build_id/builds_worker_access,
 * which grants a trusted background job full read/write access to the one build (and
 * project's provisioning_profiles) it's processing. A public endpoint must never be
 * able to write a build row through this path even by accident, so it gets its own GUC
 * and its own read-only policy rather than reusing the worker's. Also sets
 * app.install_project_id once the build's project is known, so the same transaction can
 * read that one project's config too (projects_install_select) — the manifest needs its
 * bundleId/display name. Returns undefined when no row matches, so the controller 404s
 * rather than leaking "exists but ___".
 */
export async function runInInstallLookupContext<T>(
  db: Db,
  buildId: string,
  fn: (build: typeof builds.$inferSelect) => Promise<T>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await scoped.execute(sql`select set_config('app.install_build_id', ${buildId}, true)`);
    const [build] = await scoped.select().from(builds).where(eq(builds.id, buildId));
    if (!build) {
      return undefined;
    }
    await scoped.execute(sql`select set_config('app.install_project_id', ${build.projectId}, true)`);
    return storage.run(scoped, () => fn(build));
  });
}

/**
 * Throws instead of silently falling back to an unscoped connection — a repository
 * calling this outside `runInTenantContext` is a bug, not a case to handle gracefully.
 */
export function getTenantDb(): Db {
  const tx = storage.getStore();
  if (!tx) {
    throw new Error(
      'getTenantDb() called outside runInTenantContext() — no tenant transaction is active',
    );
  }
  return tx;
}
