-- RLS for every org_id-bearing table. Policy: a row is visible only if its org_id
-- matches the current request's app.org_id setting (set via SET LOCAL in
-- packages/db/src/tenant-context.ts, inside a transaction, before any query runs).
-- FORCE ROW LEVEL SECURITY means even the table owner (mobilio_migrator) is subject to
-- the policy for ordinary DML — only an explicit BYPASSRLS role would skip it, and
-- mobilio_app has none.
--
-- current_setting(..., true) (missing_ok) returns NULL rather than erroring when
-- app.org_id was never set for the session — so a connection that skips
-- runInTenantContext() entirely sees zero rows instead of an error, which is the
-- correct fail-closed behavior for both roles.

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memberships_org_isolation" ON "memberships"
  USING ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invitations_org_isolation" ON "invitations"
  USING ("org_id" = current_setting('app.org_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "projects_org_isolation" ON "projects"
  USING ("org_id" = current_setting('app.org_id', true)::uuid);
