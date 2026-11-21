-- Same pattern as builds_org_isolation (0004_builds_rls.sql) — provisioning_profiles
-- carries org_id directly, so a single FOR ALL policy keyed on app.org_id is
-- sufficient. No cross-org SELECT-only exception needed: nothing needs to see a
-- provisioning profile before knowing which org's project it belongs to.

ALTER TABLE "provisioning_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provisioning_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "provisioning_profiles_org_isolation" ON "provisioning_profiles"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
