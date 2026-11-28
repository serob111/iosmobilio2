---
name: db-migration
description: Checklist for writing a new packages/db migration on Mobilio — RLS/FORCE, GRANT/REVOKE for mobilio_app and mobilio_migrator, migrator-only policies, org-isolation tests, idempotency. Use whenever adding or editing a migration file under packages/db.
---

# DB migration checklist

Mobilio's tenant isolation is enforced entirely at the Postgres layer (see
`docs/ARCHITECTURE.md`, [[2026-10-20-multitenancy-postgres-rls]]). A migration that forgets a
step here doesn't fail loudly — it silently reopens a cross-tenant leak. Go through every
item below for any new table or policy; most don't apply to a pure data-shape change (adding
a nullable column to an already-RLS'd table), but check anyway.

## New table with `org_id` (or a table that is itself an org-scoped entity)

- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **and** `... FORCE ROW LEVEL SECURITY` —
      both. `FORCE` is what stops `mobilio_migrator` (the table owner) from bypassing its own
      policies; omitting it is the single easiest way to accidentally leave an exploitable
      hole for anything that ever runs as the owner role.
- [ ] A base policy scoping `SELECT`/`INSERT`/`UPDATE`/`DELETE` to
      `current_setting('app.org_id', true)` matching the row's `org_id` (or its own `id`, for
      `organizations`-like tables) — mirror the pattern already used by `projects`/
      `memberships`/`invitations`.
- [ ] If the table needs a *different* identity to scope by (a token hash, a slug hash, a
      user id instead of an org id — see `drafts`, `preview_links`, builds' runner access),
      add a narrower policy for that path instead of relaxing the base one. Never widen an
      existing policy's `USING`/`WITH CHECK` to satisfy a new, unrelated access pattern.

## Roles: GRANT / REVOKE

- [ ] `GRANT` only the minimum of `SELECT`/`INSERT`/`UPDATE`/`DELETE` that `mobilio_app`
      actually needs on the new table — not a blanket `ALL`.
- [ ] If the migration adds a `SECURITY DEFINER` function (watchdog, cleanup job, any
      function meant to run with elevated privilege) — explicit
      `REVOKE EXECUTE ... FROM PUBLIC` **before** `GRANT EXECUTE ... TO mobilio_app` (or
      whichever role should call it). Postgres grants `EXECUTE` to `PUBLIC` by default on
      every new function; skipping the revoke means any role with database access can call
      it directly, not just the intended caller.
- [ ] A `SECURITY DEFINER` function needs `SET search_path = public` (or an explicit
      qualified path) — otherwise the caller's `search_path` could redirect it to a
      different, attacker-controlled object of the same name.

## Policies scoped to `mobilio_migrator` specifically

- [ ] A background job that needs to act *across* tenants (expiry cleanup, the builds
      watchdog) gets its own policy granted `TO mobilio_migrator` only (never `PUBLIC`, never
      `mobilio_app`) — and runs through a `SECURITY DEFINER` function owned by
      `mobilio_migrator`, not by connecting as that role directly from app code.

## Tests

- [ ] An isolation test: two orgs, two rows, assert org A's `runIn*Context()` can't see or
      touch org B's row (and vice versa) — not just "the happy path returns the right row."
- [ ] If the table is reachable via a capability token (not `org_id`), test that an expired/
      wrong/malformed token sees zero rows, not an error — fail-closed, matching the existing
      pattern on `drafts`/`preview_links`.
- [ ] If an `UPDATE`-issuing function is involved (a watchdog, a status transition), remember
      Postgres re-checks the policy's `USING` clause against the **resulting** row, not just
      the original — test the transition actually lands under the active policy, don't just
      trust that it compiles.

## Idempotency

- [ ] The migration is safe to run twice (`IF NOT EXISTS` / `IF EXISTS` / `ON CONFLICT` as
      appropriate) — `packages/db/sql/0000_bootstrap_roles.sql` is the reference pattern for
      this.
- [ ] If this is raw SQL rather than a Drizzle-generated migration, confirm it's still picked
      up by `npm run db:migrate --workspace=@mobilio/db` and by the CI/docker-compose
      `migrate` step.
