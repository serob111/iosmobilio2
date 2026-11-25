# Anonymous drafts via httpOnly cookie, claimed after login

**Date:** 2026-10-23 (`fce7ae9`, "drafts table + token-based RLS for anonymous draft
access").

**Decision:** Let a visitor try the product (enter a URL, edit a config, see a live preview)
with zero sign-up, by issuing a random token in an httpOnly cookie the moment they start; the
database stores only the token's sha256 hash, never the raw value. "Save as project" after
sign-in **claims** the draft — atomically moves its data into a real project under the user's
organization — rather than keeping drafts and projects as two permanently separate things.

**Why:** Requiring an account before a visitor can see any value is the single biggest drop-off
point for a "turn my website into an app" product — letting them see a working preview first,
then asking for an account only to save it, converts far more of that traffic. Storing only a
hash (not the raw token) means a database leak doesn't hand out working session tokens.

**Rejected:** Requiring sign-up before any preview (simpler, but loses the try-before-signup
funnel); storing the raw draft token in the database (rejected — a leaked database would then
directly hand out live session-equivalent tokens instead of useless hashes).

See [[ARCHITECTURE]].
