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

**Done** (through `c1e9229`, 2026-11-25 — HEAD of `stage-3`):
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

**In progress** (uncommitted on `stage-3`, working tree as of 2026-11-25 — not yet reviewed
or landed): `apps/web` wiring for the install/download flow (`BuildsBlock.tsx`,
`apiClient.ts`, `ProjectAdapter.ts`, `messages/{en,ru}.json`) and a stricter shared MSW
network-guard test policy (`apps/web/test/msw-policy.ts`, `allowed-network-hosts.ts`,
updated `mocks/server.ts`/`setup.ts`).

**Next**: finish and commit the in-progress install/download UI; verify a repacked `.ipa`
actually installs and launches on a real iPhone via the manifest/install endpoints (device
testing — can't be done from this sandbox); confirm repack wall-clock time against the
<2-minute target under realistic load.

## Parallel branch: design-web

`design-web` tracks vérstka (layout/markup) of "часть A" against the Vivid design exports in
`docs/design` (sourced from `mobilio-design-docs/`) — independent of the repack work above,
merges separately when ready.

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
