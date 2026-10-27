-- A build whose runner dies silently (crashed workflow, network partition before its
-- first/next callback) never calls /fail — it just sits in 'queued' or 'building'
-- forever, permanently occupying builds_one_active_per_project's one-active-slot for
-- that project (no new build can ever be created for it again). This sweeps those stuck
-- rows to 'failed' on a schedule, same SECURITY DEFINER-function + role-scoped-policy
-- shape as cleanup_expired_drafts (0007_drafts_rls_fix.sql).
--
-- Timeouts are hardcoded constants inside the function body, not parameters: changing
-- what counts as "stuck" is a deliberate operational decision (it interacts with how
-- long a real Xcode archive step can legitimately take), and should go through a review
-- + migration like any other change to this invariant, not be adjustable by whatever
-- value the worker process happens to pass at call time. 30 minutes queued (time
-- between creation and the runner's first /start callback — dispatch + runner cold
-- start, never the build itself) and 60 minutes building (from /start to done/failed —
-- covers a real `expo prebuild` + `pod install` + `xcodebuild archive` + upload) are
-- the same figures used in the original Этап 2 spec for this feature.
--
-- Unlike cleanup_expired_drafts (a DELETE — the row stops existing, no "new row" to
-- re-validate), this function UPDATEs. Postgres additionally requires an UPDATE's
-- *resulting* row to still be visible under the policy's own USING clause (re-evaluated
-- against the new row), not just satisfy WITH CHECK — confirmed by hand against this
-- exact table (see builds_runner_project_select in 0010 for the first time this bit).
-- That's why builds_watchdog's USING below includes 'failed' alongside 'queued'/
-- 'building': the function only ever writes 'failed', so the new row must stay
-- IN that same set for the UPDATE to succeed at all. 'done' is deliberately never
-- included — this policy must never let mobilio_migrator see or touch a successfully
-- finished build.
CREATE POLICY "builds_watchdog" ON "builds"
  FOR ALL
  TO mobilio_migrator
  USING ("status" IN ('queued', 'building', 'failed'));
--> statement-breakpoint

-- LANGUAGE sql (not plpgsql) — same as cleanup_expired_drafts, a single statement needs
-- nothing more. SECURITY DEFINER + explicit OWNER + SET search_path so a malicious
-- search_path on the calling (mobilio_app) session can't redirect "builds" to something
-- other than the real public.builds.
CREATE OR REPLACE FUNCTION public.fail_stuck_builds(batch int)
RETURNS TABLE(id uuid, org_id uuid, project_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.builds
  SET status = 'failed',
      error = 'timeout',
      token_hash = NULL,
      token_expires_at = NULL,
      finished_at = now()
  WHERE builds.id IN (
    SELECT b.id FROM public.builds b
    WHERE (b.status = 'queued' AND b.created_at <= now() - interval '30 minutes')
       OR (b.status = 'building' AND b.started_at <= now() - interval '60 minutes')
    LIMIT batch
  )
  RETURNING builds.id, builds.org_id, builds.project_id;
$$;
--> statement-breakpoint
ALTER FUNCTION public.fail_stuck_builds(int) OWNER TO mobilio_migrator;
--> statement-breakpoint
-- Postgres grants EXECUTE on every newly created function to PUBLIC by default — revoke
-- it first, so the explicit grant below is the only way anything can call this.
REVOKE EXECUTE ON FUNCTION public.fail_stuck_builds(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fail_stuck_builds(int) TO mobilio_app;
