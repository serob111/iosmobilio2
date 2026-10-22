-- RLS on organizations itself — closes a gap left by 0001_rls.sql, which only covered
-- tables that carry an org_id column. organizations IS the org (id, not org_id), but
-- the same "don't leak across tenants" requirement applies to it: without this, a
-- mobilio_app connection could SELECT every organization in the database regardless of
-- tenant context.

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;

-- Default (FOR ALL): visible/writable only within its own org's tenant context — same
-- shape as the org_id policies in 0001_rls.sql, just matching on id instead of org_id.
-- Creating an organization (insertOrganization) sets app.org_id to the new row's own id
-- before inserting, so this isn't loosened for inserts — the row satisfies its own
-- policy by construction.
CREATE POLICY "organizations_org_isolation" ON "organizations"
  USING ("id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

-- Second, SELECT-only permissive policy, OR'd with the one above: lets GET /me list
-- every organization a user belongs to, via runInUserContext() (app.user_id set,
-- app.org_id unset) — same shape as memberships_select_self in 0001_rls.sql. The EXISTS
-- subquery reads memberships under memberships' own RLS, which in this same
-- app.org_id-absent context already restricts it to the caller's own rows
-- (memberships_select_self), so this can't be used to enumerate other users' orgs.
CREATE POLICY "organizations_select_member" ON "organizations"
  FOR SELECT
  USING (
    nullif(current_setting('app.org_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1 FROM "memberships"
      WHERE "memberships"."org_id" = "organizations"."id"
        AND "memberships"."user_id" = nullif(current_setting('app.user_id', true), '')
    )
  );
