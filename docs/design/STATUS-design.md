# Design Web Status

This file is the status source for the `design-web` branch. The main stage-3 session owns
`docs/STATUS.md`; design work must not edit it.

## Current phase

Part A is complete and paused pending the owner's next signal. Do not start new screens.
The branch was synchronized with `origin/stage-3` in `4e895be`.

## Completed Part A work

- Foundations (`f8fcff2`)
- Landing (`7bdcde8`)
- Pricing (`ae5294f`)
- Sign-in (`4f976c5`)
- Workspace (`584682a`)
- Projects (`8a19d10`)
- General 404 and expired preview (`ad564b2`)
- Legal pages (`175d912`)
- Magic-link email (`2b6ff08`)
- Part A copy and responsive-overflow regression coverage (`e1f5244`)

English/Russian desktop and mobile evidence is stored in `docs/design/implemented`.

## Branch infrastructure

- `AGENTS.md` defines the design-web boundary and report format (`8c2821c`).
- Playwright supports isolated web/API ports, database name, Redis database, S3 bucket,
  and opt-in production-build mode. Codex uses ports 3200/3211, PostgreSQL database
  `mobilio_design`, Redis database 5, and S3 bucket `mobilio-design`.
- `e2e/server.ts` remains the stage-3 implementation with only its listen port made
  configurable. A duplicate Next 16 server start was not reproduced in the isolated run.

## Last completed validation

Recorded on 2026-11-28 before Redis/S3 isolation was added; do not treat it as validation
of the latest infrastructure change:

- typecheck: passed in all workspaces;
- lint: passed in all workspaces;
- Vitest: 959 passed, 201 live-infrastructure tests skipped;
- Playwright: 8/8 passed against `next start`, local PostgreSQL/Redis/MinIO, and the fake
  build runner.

No real Apple service or GitHub Actions run was performed. The next full run must include
`REQUIRE_LIVE_SERVICES=true` and wait for the owner's explicit signal.
