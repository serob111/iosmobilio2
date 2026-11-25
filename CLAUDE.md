# Mobilio

Turns a website URL into a native iOS app: an Expo/React Native shell is repacked per
client and ships through Ad Hoc / App Store / (eventually) Mobilio Preview.

Full state, architecture, and decision history live in `docs/` — read those instead of
re-deriving them from code:

- [docs/STATUS.md](docs/STATUS.md) — where the project is right now, phase by phase.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — DB/RLS, drafts/projects, builds, preview proxy, auth, storage.
- [docs/decisions/](docs/decisions/README.md) — why things are the way they are, one file per decision.

## Monorepo map

- `apps/api` — NestJS: auth (Better Auth), orgs, projects, drafts, builds, preview proxy, CSRF.
- `apps/web` — Next.js App Router UI (`next-intl`, en/ru), pure client of `apps/api` (`lib/apiClient.ts`).
- `apps/worker` — BullMQ worker: drafts/builds watchdogs, repack jobs, cleanup.
- `apps/shell` — Expo/React Native app shell (SDK 57, expo-router) that gets repacked per client.
- `packages/config` — shared zod `ProjectConfigSchema` + slug/bundleId/icon utilities.
- `packages/db` — Drizzle schema, migrations, Postgres roles, RLS, `TenantContext`.
- `packages/storage` — `ObjectStorage` interface + S3/MinIO/R2 adapter, object key helpers.
- `packages/repacker` — the repack pipeline: unzip base `.ipa`, patch Info.plist/config/icon, re-sign, re-zip.
- `packages/apple` — App Store Connect API client, bundle ID / Ad Hoc profile / device registration.

## Commands

```
npm install                                    # root install, all workspaces

docker compose up -d postgres redis minio      # infra only (or: npm run dev:infra)
npm run dev                                    # infra + web/api/worker together (concurrently)

cp packages/db/.env.example packages/db/.env
npm run db:migrate --workspace=@mobilio/db     # apply migrations

npm run typecheck                               # tsc --noEmit, all workspaces
npm run lint                                    # eslint, all workspaces

npm run test                                    # vitest, all workspaces
npm run test:coverage                           # vitest + coverage thresholds, all workspaces
npm test --workspace=@mobilio/db                # one package (swap for @mobilio/config, mobilio-api, mobilio-web, mobilio-worker, mobilio-shell, @mobilio/apple, @mobilio/repacker)
cd apps/api && npx vitest run src/builds/builds.service.spec.ts   # one file

cd apps/web && npm run test:e2e                 # Playwright, real api with BUILD_RUNNER=fake
```

## Iron rules

- **RLS is the tenant boundary, not application code.** Every table with `org_id`
  (plus `organizations` itself) has `ENABLE`+`FORCE ROW LEVEL SECURITY`. Two Postgres
  roles: `mobilio_migrator` (schema owner, runs migrations) and `mobilio_app`
  (no `BYPASSRLS`, what `api`/`worker` connect as). The **only** sanctioned way to touch
  these tables is through a `runIn*Context()` call (`packages/db/src/tenant-context.ts`)
  — never query them outside one. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Workflow inputs never go straight into a shell script.** In any `.github/workflows/*.yml`,
  every `inputs.*` reference must be passed through `env:`, never interpolated directly into
  a `run:` block — that's a shell-injection hole on a `workflow_dispatch` input.
- **Secrets never reach logs.** Build tokens, provisioning-profile keys, Apple API keys —
  mask (`::add-mask::`) before anything touches stdout/CI logs; check this by hand after any
  change to a workflow that handles a token.
- **Tests go through the shared MSW catch-all, not around it.** `test/msw-policy.ts`'s
  catch-all handler + `test/allowed-network-hosts.ts` guard every suite — an unmocked request
  to a host that isn't on the allowlist fails loudly instead of hitting the real network. Add
  to the allowlist deliberately; don't bypass it per-test.
- **80% coverage per glob, enforced by `test:coverage`.** Thresholds are scoped per-folder
  (`packages/config`, `apps/web/lib`, `apps/api` auth/organizations/builds/preview/common, …)
  — a new module in a covered folder needs tests, not an exemption.
- **One commit per fix, with its test.** Don't bundle an unrelated fix into a feature commit.
- **Every user-facing string goes through `next-intl`.** English is the default (no URL
  prefix), Russian under `/ru/...`, keys in `apps/web/messages/{en,ru}.json`. Never hardcode
  UI text in a component.
- **`shell_releases` rows are immutable once registered.** A given shell version's base
  `.ipa`/manifest never changes in place — ship a new version instead of mutating one that's
  already registered.

## Workflow

At the end of each phase: update [docs/STATUS.md](docs/STATUS.md) (what's done, with commit
hashes) and send a report — hashes, what was done, test run results, and explicitly what was
only verified against mocks/fakes (not a real Postgres/Redis/S3/Apple/GitHub Actions). After
that, the user runs `/clear`. Don't start the next phase's work before that report goes out.

# Compact instructions

If this conversation gets summarized, the summary must keep:
- the current phase (and sub-phase, if `docs/STATUS.md` has one) being worked on;
- every task in it that is still open, unfinished, or blocked;
- the list of files changed so far in the current phase (paths, not diffs);
- the result of the most recent test run (pass/fail counts, which packages, which were
  skipped for missing live infra).

Don't re-summarize `docs/STATUS.md`, `docs/ARCHITECTURE.md`, or `docs/decisions/` content —
re-read those files directly instead of carrying their contents through a compaction summary.
