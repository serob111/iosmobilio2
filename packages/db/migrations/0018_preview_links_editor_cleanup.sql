-- Same pattern as drafts_cleanup (0007_drafts_rls_fix.sql): FORCE ROW LEVEL SECURITY stays
-- on for preview_links too, so instead of exempting the table owner, this policy is scoped
-- TO mobilio_migrator specifically (permissive policies for the same role OR together, so
-- this ORs with preview_links_org_isolation/preview_links_draft_access for that role only
-- — mobilio_app is untouched). Scoped to kind='editor' deliberately: 'share' links either
-- have no expiry (project-backed) or get cascade-deleted with their draft already
-- (draft_id REFERENCES drafts.id ON DELETE CASCADE) — there's no orphaned-expired-share-
-- link case this needs to also cover.
CREATE POLICY "preview_links_cleanup" ON "preview_links"
  FOR ALL
  TO mobilio_migrator
  USING ("kind" = 'editor' AND "expires_at" < now());
--> statement-breakpoint

-- Runs as mobilio_migrator (SECURITY DEFINER + explicit owner below), so
-- preview_links_cleanup above applies and it can see/delete every expired editor link.
-- SET search_path pins which "public" is resolved, same rationale as
-- cleanup_expired_drafts.
CREATE OR REPLACE FUNCTION public.cleanup_expired_editor_preview_links(batch int)
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.preview_links
  WHERE id IN (
    SELECT preview_links.id FROM public.preview_links
    WHERE preview_links.kind = 'editor' AND preview_links.expires_at <= now()
    LIMIT batch
  )
  RETURNING preview_links.id;
$$;
--> statement-breakpoint
ALTER FUNCTION public.cleanup_expired_editor_preview_links(int) OWNER TO mobilio_migrator;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_editor_preview_links(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cleanup_expired_editor_preview_links(int) TO mobilio_app;
