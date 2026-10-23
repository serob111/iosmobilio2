-- drafts have no org_id at all — access is purely "whoever presents the matching claim
-- token", the same mechanism invitations already use for token-based lookup before an
-- org is known (see invitations_select_by_token in 0001_rls.sql). Unlike invitations'
-- narrow SELECT-only policy, drafts need the full CRUD lifecycle under token control:
-- INSERT at creation, SELECT/UPDATE while anonymously editing, DELETE at claim time.
-- A single FOR ALL policy (matching the org_id-isolation policies' shape elsewhere)
-- covers all four — Postgres applies the USING expression as the WITH CHECK expression
-- too when none is given separately, so INSERT/UPDATE are governed the same way.

ALTER TABLE "drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drafts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "drafts_token_access" ON "drafts"
  USING ("token_hash" = nullif(current_setting('app.lookup_token_hash', true), ''));
--> statement-breakpoint

-- Second, permissive, DELETE-only policy (OR'd with the one above): lets the worker's
-- hourly cleanup sweep delete anything already past its expiry through the ordinary
-- mobilio_app connection — no token, no app.* setting at all. Safe because the predicate
-- isn't secret-based: "this row already expired" is true or false regardless of who's
-- asking, so there's nothing here for a caller to learn or bypass into.
CREATE POLICY "drafts_delete_expired" ON "drafts"
  FOR DELETE
  USING ("expires_at" < now());
--> statement-breakpoint

-- Postgres requires UPDATE/DELETE rows to separately pass a SELECT/ALL-policy check
-- (OR'd together) AND an UPDATE/DELETE-policy check (OR'd together) — these two groups
-- are ANDed, not merged into one flat OR. Since drafts_token_access is FOR ALL, it's the
-- only contributor to the SELECT half, so without this policy the combined expression
-- degrades to "token_match AND (token_match OR expired)", which absorbs down to just
-- token_match — drafts_delete_expired's own USING clause never actually gets a chance to
-- pass anything on its own. This mirrors the matching predicate into the SELECT half too,
-- so an unscoped connection can both see and delete an expired row.
CREATE POLICY "drafts_expired_select" ON "drafts"
  FOR SELECT
  USING ("expires_at" < now());
