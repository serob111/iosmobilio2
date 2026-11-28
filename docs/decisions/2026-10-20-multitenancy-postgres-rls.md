# Multi-tenancy via Postgres RLS with mobilio_app/mobilio_migrator

**Date:** 2026-10-20 (`2f84756`, "Drizzle schema, migrations, RLS roles/policies,
TenantContext").

**Decision:** Enforce tenant isolation in Postgres itself via Row Level Security (`ENABLE` +
`FORCE`), with two roles — `mobilio_migrator` (schema owner, runs migrations, can be granted
narrow `SECURITY DEFINER`-function access) and `mobilio_app` (no `BYPASSRLS`, what the
running `api`/`worker` processes connect as). Access to org-scoped tables goes only through
transaction-scoped `SET LOCAL` calls inside `runIn*Context()`.

**Why:** A bug in application code (a missing `WHERE org_id = ?`, a forgotten filter in a new
endpoint) is a matter of time across a growing codebase — RLS makes that class of bug
physically unable to leak another organization's rows, because the database itself refuses
the row, not application logic that could be wrong or get bypassed. Forcing RLS even for the
schema owner closes the common escape hatch where "just use the owner connection for this one
admin script" quietly reintroduces the exact risk RLS exists to remove.

**Rejected:** Enforcing tenant scoping only in application code (ORM-level `WHERE` clauses) —
rejected because it relies on every query, present and future, remembering to apply it;
RLS makes omission itself the failure mode that can't happen, not a discipline to maintain.

See [[ARCHITECTURE]].
