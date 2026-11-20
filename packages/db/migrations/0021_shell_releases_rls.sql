-- shell_releases has no tenant concept at all (no org_id/user_id) — it's a single
-- global table of compiled apps/shell base builds, written only by the internal,
-- SHELL_RELEASE_SECRET-authenticated endpoint and read only by the repack worker. RLS is
-- still enabled/forced here for defense in depth and consistency with every other table
-- in this schema, but the policy itself is permissive by design: the real access
-- control is the app-layer secret guard on that endpoint, not a GUC-scoped condition —
-- there is no app.org_id-equivalent setting for "which base builds may this caller see".
ALTER TABLE "shell_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shell_releases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "shell_releases_app_access" ON "shell_releases"
  USING (true)
  WITH CHECK (true);
