-- Missed in 0025: the repack worker job needs to read the project's own config
-- (bundleId, name, theme, tabs, features, allowedDomains — everything repack() needs)
-- for the one project it's actively processing, not just the builds/provisioning_profiles
-- rows. Mirrors projects_build_runner_select/projects_preview_select exactly — SELECT
-- only, scoped to app.worker_build_project_id (set by runInWorkerBuildContext only
-- after it already found the build by id), since the worker never needs to write a
-- project row.

CREATE POLICY "projects_worker_access" ON "projects"
  FOR SELECT
  USING ("id" = nullif(current_setting('app.worker_build_project_id', true), '')::uuid);
