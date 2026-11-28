-- The repack worker job (apps/worker) processes a build it only knows the raw id of
-- (a BullMQ job payload, {buildId} — see apps/api's RepackRunner/QueueService) — it has
-- no session, no org_id, and deliberately no per-build secret token the way
-- GithubActionsRunner's callback flow does (an in-process worker job never calls back
-- over HTTP at all, so there's nothing to hand it a token for). What stands in for that
-- proof is structural: nothing outside apps/worker's own trusted job-processing code
-- ever calls runInWorkerBuildContext (packages/db/src/tenant-context.ts) or sets
-- app.worker_build_id/app.worker_build_project_id — no HTTP-request-driven code path
-- sets either GUC, so a build id alone is never enough for an ordinary request to reach
-- these policies. Same trust category as builds_watchdog's SECURITY DEFINER sweep,
-- just scoped to the one build (and its one project, for provisioning_profiles) the
-- worker is actively processing rather than a global sweep.

CREATE POLICY "builds_worker_access" ON "builds"
  USING ("id" = nullif(current_setting('app.worker_build_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "provisioning_profiles_worker_access" ON "provisioning_profiles"
  USING ("project_id" = nullif(current_setting('app.worker_build_project_id', true), '')::uuid);
