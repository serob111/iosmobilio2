-- Drop the two policies added in 0006 as a workaround for Postgres's documented
-- UPDATE/DELETE rule (a row must pass BOTH the SELECT/ALL-policy group AND the
-- command-specific-policy group, ANDed, not merged into one flat OR). That workaround
-- let any unscoped mobilio_app connection see/delete expired rows. Replaced below by
-- folding expiry directly into drafts_token_access plus a single SECURITY DEFINER
-- cleanup function — no ordinary connection needs expiry-based access at all anymore.
DROP POLICY "drafts_expired_select" ON "drafts";
--> statement-breakpoint
DROP POLICY "drafts_delete_expired" ON "drafts";
--> statement-breakpoint

-- Recreate drafts_token_access with expiry folded into the one policy that governs
-- ordinary (token-holding) access: an expired draft is now invisible, and un-writable,
-- even to someone presenting the exact right token — not just to the cleanup job on its
-- own schedule. Postgres has no "ALTER POLICY ... ADD CONDITION"; changing a policy's
-- USING/WITH CHECK means drop and recreate.
DROP POLICY "drafts_token_access" ON "drafts";
--> statement-breakpoint
CREATE POLICY "drafts_token_access" ON "drafts"
  USING ("token_hash" = nullif(current_setting('app.lookup_token_hash', true), '') AND "expires_at" > now())
  WITH CHECK ("token_hash" = nullif(current_setting('app.lookup_token_hash', true), '') AND "expires_at" > now());
--> statement-breakpoint

-- FORCE ROW LEVEL SECURITY stays on — it's deliberate on every RLS table in this schema
-- as a second line of defense, including for mobilio_migrator itself, not something to
-- carve an exception into just for this one table. Instead of exempting the owner, this
-- policy is scoped TO mobilio_migrator specifically (not PUBLIC, not mobilio_app) —
-- permissive policies for the same role OR together, so for mobilio_migrator this ORs
-- with drafts_token_access above; mobilio_app is untouched, since the policy doesn't
-- apply TO that role at all.
CREATE POLICY "drafts_cleanup" ON "drafts"
  FOR ALL
  TO mobilio_migrator
  USING ("expires_at" < now());
--> statement-breakpoint

-- Runs as mobilio_migrator (SECURITY DEFINER + explicit owner below), so drafts_cleanup
-- above applies and it can see/delete every expired row — the one deliberate, narrow
-- bypass of drafts_token_access's otherwise-absolute token+expiry requirement, reachable
-- only through this function's own fixed SQL (the "batch" argument only bounds how many
-- rows one call processes, it can't be twisted into reading non-expired rows). SET
-- search_path pins which "public" is resolved, so a malicious search_path set by the
-- calling session can't trick this definer-rights function into resolving an
-- attacker-controlled object instead of the real public.drafts.
CREATE OR REPLACE FUNCTION public.cleanup_expired_drafts(batch int)
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.drafts
  WHERE id IN (
    SELECT drafts.id FROM public.drafts
    WHERE drafts.expires_at <= now()
    LIMIT batch
  )
  RETURNING drafts.id;
$$;
--> statement-breakpoint
ALTER FUNCTION public.cleanup_expired_drafts(int) OWNER TO mobilio_migrator;
--> statement-breakpoint
-- Postgres grants EXECUTE on every newly created function to PUBLIC by default — revoke
-- it first, so the explicit grant below is the only way anything can call this.
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_drafts(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cleanup_expired_drafts(int) TO mobilio_app;
