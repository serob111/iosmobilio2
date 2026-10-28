-- preview_links has three completely distinct access paths, each needing its own policy
-- (same "identity via token, not membership" shape already used for invitations/drafts):
--   1. An org member managing their project's link — scoped by org_id, like every other
--      org_id-bearing table (projects_org_isolation etc.).
--   2. An anonymous draft owner managing their draft's link — there's no org_id at all on
--      a draft-backed row, so this is scoped through a subquery against drafts itself,
--      keyed on the SAME app.lookup_token_hash DraftGuard already sets. The subquery is
--      itself subject to drafts' own RLS (drafts_token_access), so this can't be used to
--      probe a draft that wouldn't otherwise be visible.
--   3. The public GET /preview/:slug reader — no session, no draft cookie, just the slug
--      itself. Scoped by a NEW setting (app.lookup_slug_hash), SELECT-only, and gated on
--      not-revoked/not-expired so a dead link 404s instead of leaking its target project/
--      draft id to whoever still has the URL.
ALTER TABLE "preview_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preview_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "preview_links_org_isolation" ON "preview_links"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "preview_links_draft_access" ON "preview_links"
  USING (
    "draft_id" IN (
      SELECT "id" FROM "drafts"
      WHERE "token_hash" = nullif(current_setting('app.lookup_token_hash', true), '')
        AND "expires_at" > now()
    )
  )
  WITH CHECK (
    "draft_id" IN (
      SELECT "id" FROM "drafts"
      WHERE "token_hash" = nullif(current_setting('app.lookup_token_hash', true), '')
        AND "expires_at" > now()
    )
  );
--> statement-breakpoint

CREATE POLICY "preview_links_slug_lookup" ON "preview_links"
  FOR SELECT
  USING (
    "slug_hash" = nullif(current_setting('app.lookup_slug_hash', true), '')
    AND "revoked_at" IS NULL
    AND ("expires_at" IS NULL OR "expires_at" > now())
  );
--> statement-breakpoint

-- Once a preview_links row is found by slug, its project_id/draft_id is known but its
-- org_id (for a project link) or token_hash (for a draft link, never even stored on
-- preview_links) is not available to re-derive a tenant/token context from — the public
-- reader never had a session or a draft cookie in the first place. These two narrow
-- SELECT-only policies, keyed on project_id/draft_id directly (set by
-- runInPreviewLookupContext right after the slug lookup above, in the same transaction),
-- are what let that same unauthenticated connection then read exactly the one project or
-- draft the link points at — same pattern as projects_build_runner_select (0010).
CREATE POLICY "projects_preview_select" ON "projects"
  FOR SELECT
  USING ("id" = nullif(current_setting('app.preview_project_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "drafts_preview_select" ON "drafts"
  FOR SELECT
  USING ("id" = nullif(current_setting('app.preview_draft_id', true), '')::uuid);
