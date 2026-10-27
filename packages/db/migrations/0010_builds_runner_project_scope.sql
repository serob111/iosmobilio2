-- The build runner only ever needs to read ONE project — the one its own build row
-- points at — never the rest of its org (other projects, other builds, memberships,
-- invitations). runInBuildContext (packages/db/src/tenant-context.ts) used to set
-- app.org_id once a build's org was known, which — via projects_org_isolation
-- (0001_rls.sql) — handed the runner read access to every project in that org, far more
-- than it needs. runInBuildContext no longer sets app.org_id at all; it sets
-- app.build_project_id instead, and this policy is scoped to exactly that one row.
CREATE POLICY "projects_build_runner_select" ON "projects"
  FOR SELECT
  USING ("id" = nullif(current_setting('app.build_project_id', true), '')::uuid);
--> statement-breakpoint

-- Required for the runner's own state-transition UPDATEs on "builds" to keep working at
-- all now that app.org_id is no longer set: Postgres requires an UPDATE's *resulting*
-- row to still be visible under the table's SELECT-governing policies, not just pass
-- WITH CHECK — previously builds_org_isolation (org_id never changes across a
-- transition) satisfied that incidentally; removing app.org_id removed it too. Scoped to
-- project_id (not id/token_hash) so it survives the token being cleared and the status
-- moving to done/failed — exactly the transition this is for — while still being far
-- narrower than org-wide: it only ever exposes this one project's OWN builds, nothing
-- from any other project in the org.
CREATE POLICY "builds_runner_project_select" ON "builds"
  FOR SELECT
  USING ("project_id" = nullif(current_setting('app.build_project_id', true), '')::uuid);
