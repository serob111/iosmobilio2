# design-web agent instructions

Read `CLAUDE.md`, `docs/STATUS.md`, and `docs/design/README.md` before changing code. Their project rules apply in addition to this file.

## Scope

This branch owns:

- `apps/web` layout and user-facing design work for the Vivid screens;
- `docs/design`, including reference exports and `docs/design/implemented` screenshots;
- transactional email presentation in `apps/api/src/mail`;
- the smallest API or database contract change required to connect an approved design screen to real data.

Do not change repack or release work owned by the parallel stage-3 effort: `apps/shell`, `apps/worker`, `packages/repacker`, `packages/apple`, `.github/workflows`, `apps/api/src/builds`, or `shell-releases`. When syncing stage-3, preserve its version of shared test infrastructure and layer only design-web-specific configuration on top.

## E2E isolation

Codex must use an isolated Playwright environment so another session can run repack E2E concurrently:

```powershell
$env:E2E_WEB_PORT='3200'
$env:E2E_API_PORT='3211'
$env:E2E_DATABASE_NAME='mobilio_design'
$env:E2E_USE_BUILD='1'
npm.cmd run build
npx.cmd playwright test --workers=1
```

Create and migrate `mobilio_design` before the run when it does not exist. Do not stop, reuse, or modify processes and databases belonging to another worktree.

## Design workflow

Use `docs/design/screens/*.png` as the visual reference and `docs/design/source/*.dc.html` for exact values and states. Use real API data in product code; mock data belongs only in tests and screenshot fixtures. All visible copy must use `next-intl` with both English and Russian messages. Verify responsive behavior at 1440, 390, and 320 pixels and keep screenshots in `docs/design/implemented`.

Keep one commit per screen or independent fix, with its tests. At the end of the phase, update `docs/STATUS.md` and stop after the report.

## Report format

The phase report must include:

- commit hashes, grouped by screen or infrastructure fix;
- completed Part A screens and screenshot paths;
- API and database changes;
- deliberate differences from the Vivid mockups;
- typecheck, lint, Vitest, and Playwright results;
- what was verified with mocks or fakes, and what was verified against real local PostgreSQL, Redis, S3, Apple services, or GitHub Actions.
