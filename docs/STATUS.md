# Status

See [[ARCHITECTURE]] for how the system works and [[README]] (in `decisions/`) for why it's
built this way. This file is the only one that should be read to answer "where are we right
now" — update it at the end of every phase, before sending the phase report.

## Completed stages

### Этап 1 — foundation, auth, multi-tenancy
No tag, no tracked PR number (merged straight to `main`). Landed: Postgres/Redis/Docker
Compose dev environment, Drizzle schema + `mobilio_app`/`mobilio_migrator` roles + RLS,
`TenantContext`, Better Auth (magic link + Google), organizations/memberships/invitations.
Commit: `d22c6cb` (2026-10-22).

### Этап 2 — drafts, projects, builds, preview, web fully on api
Tag **`v0.2.0`**, shipped via **PR #3** (`a686511`, 2026-11-13) and **PR #4** (`c89050b`,
2026-11-20, folded in the start of Этап 3 Фаза 1 alongside it: shell base identity/push
notifications, `shell_releases`, `build-shell-base.yml`/`activate-shell-release.yml`).
Landed: anonymous cookie-token drafts with claim-on-login, SSRF-safe site analysis,
GitHub-Actions-dispatched builds (`BuildRunner` interface), per-slug-subdomain preview proxy,
CSRF middleware, and `apps/web` fully migrated onto `apps/api` (i18n, shared editor,
legacy-data migration script, `/p/[id]` → `410`).

## Current stage: repack

Goal: replace the ~10-minute GitHub Actions macOS build-from-source with repacking a
pre-built shell `.ipa` — unzip, patch Info.plist/config/icon/splash, re-sign with
`rcodesign`, re-zip, target under 2 minutes, runnable on an ordinary Linux box.

**Done** (through `933a185`, 2026-11-26 — HEAD of `stage-3`):
- `packages/repacker`: streaming zip extract/create + checksum, Info.plist patching, client
  icon/splash generation (`sharp`), config/splash bundle + entitlements/profile writing,
  `rcodesign` sign+verify, full `repack()` orchestrator (`d6e2822`..`466658f`).
- `packages/apple`: App Store Connect API client (ES256 JWT), `ensureBundleId`,
  `ensureAdHocProfile` (DB-cached, 7-day reuse), `.p12` loader, device-list helper
  (`9ce9a40`..`04c84c5`).
- `RepackRunner` as a third `BuildRunner` alongside `github`/`fake`; `builds.kind` +
  incrementally-persisted `step_timings`; dedicated repack queue (`1ec5c5a`, `d25e848`,
  `c1e9229`).
- `apps/worker`: `processRepackJob` end-to-end, sha256-keyed local disk cache for the base
  `.ipa`, encrypted `PROVISIONING_PROFILE_KEY` cache, `REPACK_ENABLED` wiring
  (`422693d`, `79a65a2`, `29032f0`, `0fdde00`).
- Public install endpoint (`manifest.plist` + `install.ipa`) and adhoc builds' own, shorter
  watchdog thresholds (`bb9c5ec`, `968e44b`).
- `apps/web`: closed a real MSW `onUnhandledRequest`-bypass gap in apps/web's own test
  suite, same catch-all-handler fix already shipped for apps/api (`91288fa`). Live build
  progress in `BuildsBlock` — `step_timings` surfaced as a per-step checklist with
  durations, humanized from the repack job's own step names, plus the actual
  `itms-services://` "Install on iPhone" link (merely linking the raw `.ipa` triggers no
  install prompt on-device) and a corrected Ad Hoc disclaimer (`933a185`).

**Next** (Фаза 6 of repack, not yet started): fixture base `.ipa` for tests/CI, a real
end-to-end repack integration test, `npm run bench:repack` with p50/p95 assertions against
the <2-minute target, a Playwright E2E test for the full "Test on iPhone" flow, and a
README covering the repack architecture/release process/env vars/limitations. After that:
verify a repacked `.ipa` actually installs and launches on a real iPhone via the
manifest/install endpoints (device testing — can't be done from this sandbox).

## Parallel branch: design-web

`design-web` tracks vérstka (layout/markup) of "часть A" against the Vivid design exports in
`docs/design` (sourced from `mobilio-design-docs/`) — independent of the repack work above,
merges separately when ready.

**Part A complete** (2026-11-28): foundations, landing, pricing, sign-in, workspace,
projects, general 404, expired preview, legal pages, and the sign-in email are implemented
with English/Russian copy and responsive screenshots in `docs/design/implemented`
(`f8fcff2`..`e1f5244`). `design-web` was merged with `origin/stage-3` (`4e895be`), its
working boundaries and report format were recorded in `AGENTS.md` (`8c2821c`), and
Playwright received isolated web/API/database settings plus opt-in production-build mode
(`eb1fe1c`). Validation: full typecheck and lint passed; Vitest passed 959 tests with 201
live-infrastructure tests skipped; Playwright passed 8/8 against `next start`, real local
PostgreSQL/Redis/MinIO, and the fake build runner on ports 3200/3211 with database
`mobilio_design`. No real Apple service or GitHub Actions run was performed. The branch is
paused after Part A pending the owner's next signal.

## Plan, in order

1. **repack** (current, see above)
2. shell polish (icons-as-loose-PNGs, JS splash, deep links) — [[2026-11-20-adhoc-icons-separate-png-js-splash]]
3. Ad Hoc distribution on the Mobilio Apple Developer account
4. payment via Paddle
5. push notifications (direct APNs)
6. App Store publication, on the client's own Apple Developer account
7. layout/markup to match the Vivid design (merge of `design-web`)
8. production infrastructure (Hetzner VPS, domains, TLS)
9. beta
10. Mobilio Preview

## Open questions / blocked on the owner

- Apple Developer account for Mobilio (Ad Hoc distribution) — not yet provisioned.
- Distribution certificate `.p12` + its password.
- App Store Connect API key (issuer ID, key ID, `.p8`).
- Paddle account (Merchant of Record setup).
- Production domains (main site + `PREVIEW_PROXY_DOMAIN` wildcard; the latter also needs a
  [Public Suffix List](https://publicsuffix.org/submit/) submission before public launch).
- GitHub repository secrets still needed for a real (non-test) deploy: `API_PUBLIC_URL`,
  `SHELL_RELEASE_SECRET`.
