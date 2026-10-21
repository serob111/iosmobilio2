-- RLS for every org_id-bearing table. Policy: a row is visible only if its org_id
-- matches the current request's app.org_id setting (set via SET LOCAL in
-- packages/db/src/tenant-context.ts, inside a transaction, before any query runs).
-- FORCE ROW LEVEL SECURITY means even the table owner (mobilio_migrator) is subject to
-- the policy for ordinary DML — only an explicit BYPASSRLS role would skip it, and
-- mobilio_app has none.
--
-- current_setting(..., true) (missing_ok) returns NULL when a custom GUC was never
-- touched in this session — but on a pooled connection that HAS run a prior tenant
-- transaction, Postgres resets SET LOCAL's custom GUC to '' (empty string) after
-- commit, not back to NULL. nullif(..., '') folds that '' back to NULL before the
-- ::uuid cast, so a connection with no active tenant context fails closed (zero rows)
-- instead of erroring with "invalid input syntax for type uuid" on next use.

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
-- Default (FOR ALL, so it governs INSERT/UPDATE/DELETE too, not just SELECT): a row is
-- visible/writable only within its own org's tenant context.
CREATE POLICY "memberships_org_isolation" ON "memberships"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

-- Second, SELECT-only permissive policy, OR'd with the one above: lets a user see their
-- own membership row in every org they belong to (e.g. "GET /me" listing all of a
-- user's orgs), via runInUserContext() which sets app.user_id but leaves app.org_id
-- unset. Gated on app.org_id being absent — otherwise this would also apply during
-- ordinary runInTenantContext() calls (which set both settings) and leak every org a
-- user belongs to into what's supposed to be a single org's scoped query. Deliberately
-- SELECT-only too — it must not loosen INSERT/UPDATE/DELETE, or a user could grant
-- themselves membership in an org they don't belong to just by matching on user_id.
CREATE POLICY "memberships_select_self" ON "memberships"
  FOR SELECT
  USING (
    nullif(current_setting('app.org_id', true), '') IS NULL
    AND "user_id" = nullif(current_setting('app.user_id', true), '')
  );
--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invitations_org_isolation" ON "invitations"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

-- Accepting an invitation means looking it up by its raw token before we know which
-- org it belongs to — the same "don't know org_id yet" problem as GET /me, solved the
-- same way: a SELECT-only policy gated on app.org_id being absent, this time matching
-- on token_hash instead of user_id (via runInTokenLookupContext, which sets
-- app.lookup_token_hash only). Safe because token_hash is a SHA-256 hash of a random,
-- unguessable token — presenting the exact right value already proves the right to
-- read that one row, independent of org membership.
CREATE POLICY "invitations_select_by_token" ON "invitations"
  FOR SELECT
  USING (
    nullif(current_setting('app.org_id', true), '') IS NULL
    AND "token_hash" = nullif(current_setting('app.lookup_token_hash', true), '')
  );
--> statement-breakpoint

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "projects_org_isolation" ON "projects"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
