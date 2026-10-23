import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Db } from './client';

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
