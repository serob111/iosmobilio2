-- Same pattern as projects_org_isolation (0001_rls.sql) — builds carries org_id, so a
-- single FOR ALL policy keyed on app.org_id is sufficient. No cross-org SELECT-only
-- exception needed (unlike memberships/invitations/organizations): nothing needs to see
-- a build before knowing which org it belongs to.

ALTER TABLE "builds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "builds" FORCE ROW LEVEL SECURITY;

CREATE POLICY "builds_org_isolation" ON "builds"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
