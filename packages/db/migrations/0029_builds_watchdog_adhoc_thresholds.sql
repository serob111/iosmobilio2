-- Phase 5 item 4: 'adhoc' (repack) builds get their own, much shorter stuck-build
-- thresholds — queued 3 minutes, building 5 minutes, matching the whole feature's own
-- p95 time budget (worker ≤60s, click-to-ready ≤120s including queue wait) — a repack
-- build legitimately stuck for 30/60 minutes the way a real Xcode archive sometimes is
-- would mean something is already badly wrong, not "still working". 'appstore' kind
-- keeps the original 30/60-minute thresholds completely unchanged — explicitly
-- requested: "пороги GitHub-сборок не менять".
--
-- CREATE OR REPLACE FUNCTION preserves the function's existing OWNER and GRANTs (its
-- signature is unchanged) — no need to re-run the ALTER FUNCTION OWNER TO/REVOKE/GRANT
-- statements from 0012_builds_watchdog.sql.
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
    WHERE
      (b.kind = 'adhoc' AND (
        (b.status = 'queued' AND b.created_at <= now() - interval '3 minutes')
        OR (b.status = 'building' AND b.started_at <= now() - interval '5 minutes')
      ))
      OR
      (b.kind = 'appstore' AND (
        (b.status = 'queued' AND b.created_at <= now() - interval '30 minutes')
        OR (b.status = 'building' AND b.started_at <= now() - interval '60 minutes')
      ))
    LIMIT batch
  )
  RETURNING builds.id, builds.org_id, builds.project_id;
$$;
