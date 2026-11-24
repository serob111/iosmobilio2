-- The install endpoint (apps/api, public, unauthenticated — an iOS device fetching an
-- itms-services manifest.plist / the .ipa itself has no session/cookies) needs to read
-- a build row by its raw id, the same way the worker does — but it must never be able
-- to WRITE one, the way builds_worker_access (0025) grants. A dedicated, SELECT-only
-- policy and its own GUC, rather than reusing app.worker_build_id/builds_worker_access,
-- keeps "trusted backend job, full access" and "public, read-only install link"
-- conceptually and permission-wise separate even though the underlying id-match
-- condition is the same shape.

CREATE POLICY "builds_install_select" ON "builds"
  FOR SELECT
  USING ("id" = nullif(current_setting('app.install_build_id', true), '')::uuid);
--> statement-breakpoint

-- Same reasoning, one level further: the manifest needs the project's own name/
-- bundleId too (projectConfig), set only after runInInstallLookupContext already
-- found the build by id — mirrors projects_preview_select/projects_build_runner_select
-- exactly (SELECT only, scoped to one project).
CREATE POLICY "projects_install_select" ON "projects"
  FOR SELECT
  USING ("id" = nullif(current_setting('app.install_project_id', true), '')::uuid);
