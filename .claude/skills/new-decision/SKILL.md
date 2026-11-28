---
name: new-decision
description: How to add a new entry to docs/decisions/ on Mobilio. Use whenever a real architecture/product/vendor decision gets made (not every small implementation choice) and needs to survive a /clear.
---

# Recording a new decision

`docs/decisions/` is a journal, one file per decision, so a future session (after a `/clear`)
can find out *why* something is the way it is without re-deriving it from code or re-asking
the user. Not every choice belongs here — use judgment: a real architecture/vendor/product
decision with rejected alternatives, yes; a routine implementation detail, no (that belongs
in a commit message or nowhere).

## Steps

1. **Pick the date.** Prefer the git commit that first implements the decision
   (`git log --all --pretty="format:%h %ai %s" | grep ...`) over today's date — that's what
   makes the journal useful as history, not just a log of when someone wrote the file. If no
   commit implements it yet (a decided-but-not-built product/pricing choice), say so
   explicitly in the file rather than picking a date that implies otherwise — see
   `docs/decisions/2026-11-22-payment-paddle-merchant-of-record.md` for the pattern.
2. **Name the file** `YYYY-MM-DD-short-kebab-slug.md`, in `docs/decisions/`.
3. **Write it short**, in this shape:
   - `# Title` — the decision itself, as a title.
   - `**Date:**` — with a one-line note on how the date was determined.
   - `**Decision:**` — what was decided, concretely.
   - `**Why:**` — the reasoning, especially anything non-obvious (a constraint, an incident,
     a tradeoff the user or the code revealed).
   - `**Rejected:**` — the alternative(s) considered and why they lost. If there genuinely
     were none, say so rather than inventing some.
   - A closing `See [[...]]` line linking related decisions/`STATUS`/`ARCHITECTURE` by their
     Obsidian wiki-link filename (no `.md`, no path — `docs/` is one flat Obsidian vault for
     linking purposes even though files live in subfolders).
4. **Add it to `docs/decisions/README.md`** — one bullet, linked, in roughly chronological
   order with the rest.
5. **Cross-link it** from `docs/ARCHITECTURE.md` and/or `docs/STATUS.md` wherever the
   decision explains a piece of the system or a plan item those files already describe —
   don't leave it an orphan only reachable from the decisions index.

## Don't

- Don't restate the decision's content inside `STATUS.md`/`ARCHITECTURE.md` — link to it.
- Don't retroactively edit an old decision file to reflect a later reversal — add a *new*
  decision file for the reversal and note in it which earlier decision it supersedes.
