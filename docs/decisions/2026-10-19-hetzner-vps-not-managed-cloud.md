# Own VPS (Hetzner), not Supabase or AWS

**Date:** 2026-10-19 (`32b9933`, `docker-compose.yml` + dotenv loading + `npm run dev`
orchestration — the dev environment was built around a self-hosted Postgres/Redis/MinIO
stack from the start, not a managed-service SDK).

**Decision:** Run production on a self-managed VPS (Hetzner), with Postgres, Redis, and
object storage (R2, Cloudflare's S3-compatible service) as the only external managed pieces —
not Supabase and not AWS.

**Why:** The RLS/multi-tenancy model ([[2026-10-20-multitenancy-postgres-rls]]) and the
`TenantContext`/`runIn*Context()` pattern are built directly against plain Postgres roles and
policies — Supabase's own auth/row-level-security tooling would mean adopting its conventions
instead, and its pricing scales awkwardly for a dev-heavy monorepo. AWS's per-service billing
and configuration surface is more than this project's infrastructure footprint (one app
server, one worker, Postgres, Redis, object storage) needs; a Hetzner VPS running Docker
Compose mirrors the exact local dev setup, so "works locally" and "works in prod" are the
same stack, not two different ones to keep in sync.

**Rejected:** Supabase (couples auth/RLS tooling to its own conventions instead of plain
Postgres), AWS (more infrastructure surface and cost than this footprint needs).

See [[ARCHITECTURE]].
