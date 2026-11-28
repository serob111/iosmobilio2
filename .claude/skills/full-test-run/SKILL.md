---
name: full-test-run
description: Run Mobilio's full test suite (typecheck, lint, vitest across all workspaces, optionally Playwright) via a subagent, so only a per-package summary and failing-test text come back into the main session — not the raw log. Use before a phase-report, or whenever you need a full green/red read on the repo without blowing up context.
---

# Full test run

A full `npm run test:coverage` across every workspace, plus Playwright, produces a lot of
output — most of it passing-test noise that's pure cost to carry in the main conversation.
Run it through a subagent instead and let the subagent do the reading; it reports back a
compressed result.

## How to invoke

Spawn an `Agent` (subagent_type: general-purpose is fine; this doesn't need an isolated
worktree — it's read-only against the working tree) with a self-contained prompt that:

1. Runs, in order: `npm run typecheck`, `npm run lint`, `npm run test:coverage`. If live
   Postgres/Redis/S3 are up (check `docker compose ps`, or ask the caller to confirm whether
   `npm run dev:infra` is running), also run `cd apps/web && npm run test:e2e` for Playwright.
2. For each command, reads the **full** output itself (it has no context budget concern the
   main session has) rather than truncating early.
3. Returns to the caller **only**:
   - a one-line pass/fail per package/workspace (`@mobilio/config`, `@mobilio/db`,
     `@mobilio/storage`, `@mobilio/apple`, `@mobilio/repacker`, `mobilio-api`, `mobilio-web`,
     `mobilio-worker`, `mobilio-shell`, plus Playwright if it ran);
   - coverage-threshold pass/fail per the 80%-gated globs, if `test:coverage` ran;
   - the **full text** of every failing test (name + assertion/error + relevant stack frame),
     not a truncated snippet — this is the part a human actually needs to act on;
   - which suites were skipped for missing live infra (Postgres/Redis health-checked tests
     silently skip locally without env vars — say so explicitly, don't let a skip read as a
     pass).
4. Does not attempt to fix anything — this skill is read-only diagnostics, not a repair loop.

## Why this shape

- The main session needs a decision ("is this phase green or not, and if not, exactly what
  broke"), not a transcript. Routing the raw run through a subagent keeps that transcript out
  of the context that has to carry the rest of the phase's work.
- Full failure text (not a truncated tail) matters because the `PreToolUse` hook on
  `npm test`/`vitest`/`playwright` commands (`.claude/hooks/truncate-test-output.sh`) caps
  what a *direct* run shows in this session to the last 120 lines — fine for a quick check,
  not enough to see every failure in a large suite. The subagent reading its own full output
  doesn't have that constraint.

## Use before

`phase-report` — a phase report's test-results line should be the summary this skill
produces, not a hand-waved "tests pass."
