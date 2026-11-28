---
name: phase-report
description: Compile a phase report and update docs/STATUS.md at the end of a work phase. Use when a phase of work (a repack sub-phase, Ad Hoc, Paddle, etc.) is finished, before sending the report that precedes the user's /clear.
---

# Phase report

Mobilio's workflow (see root `CLAUDE.md`) is: finish a phase → update `docs/STATUS.md` →
send a report → the user runs `/clear`. This skill is how to do the first two steps without
skipping anything the report needs.

## Steps

1. **Collect what changed.** `git log --oneline <last-known-hash>..HEAD` (or since the start
   of the phase) for every commit this phase produced. Don't eyeball it from memory — pull
   the real hashes.
2. **Run the tests.** Use the `full-test-run` skill for this — don't dump a full raw test log
   into this conversation. You need the per-package pass/fail summary and the full text of
   any failures.
3. **Separate what was actually verified from what wasn't.** Explicitly list:
   - what ran against real infra (a live Postgres/Redis/S3, a real GitHub Actions dispatch,
     a real device install) and passed;
   - what only ran against `FakeRunner`, MSW mocks, or other fakes — these are *not* the same
     claim as "verified for real," say so plainly;
   - anything that needs a Mac, a physical iPhone, or an external account (Apple, Paddle)
     this sandbox can't exercise at all.
4. **Update `docs/STATUS.md`:**
   - Move finished items from "in progress"/"next" into the current phase's "Done" list,
     each with its commit hash.
   - Update "In progress" to reflect what's actually still open.
   - Update "Next" if the plan order changed.
   - If the whole phase (e.g. "repack") is finished, move it to "Completed stages" with its
     tag/PR number if one exists, and promote the next item in the plan to "Current stage."
5. **Send the report.** Short, structured, in this order: commit hashes, what was done, test
   results (pass/fail counts per package), what was verified only on mocks/fakes, open
   blockers. Then stop — don't start the next phase's work in the same turn. The user will
   `/clear` and start the next phase fresh.

## Don't

- Don't claim something is "done" in `docs/STATUS.md` if it only passed against a fake
  runner or mocked network — say "done, mock-verified" or list it under a caveat instead.
- Don't fold multiple phases' commits into one report — report the phase that just finished.
