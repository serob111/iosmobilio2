# Native features without code: three tiers; Face ID via webcredentials + iCloud Keychain

**Date:** undated — a product-scope decision with no implementing commit yet (no tier-gating
or Face ID code exists in the repo as of this writing).

**Decision:** Offer native device capabilities to clients without them writing code, at three
increasing tiers: (1) a button exposed in the shell with no extra setup; (2) a button plus a
file the client adds to their own website; (3) a button plus connecting an external service.
Face ID sign-in specifically is implemented via `webcredentials` (the associated-domains
mechanism, already partly wired — see `apple-app-site-association`,
[[2026-11-20-adhoc-icons-separate-png-js-splash]]'s neighboring commit `0ed1289`) and iCloud
Keychain, not a bespoke native auth flow.

**Why:** Clients are website owners, not app developers — a tiered model lets simple features
(a native share sheet, a call button) ship with zero client-side work, while features that
need more integration (a webhook, a connected service) scale the client's effort to match what
the feature actually requires, instead of demanding the same setup complexity for every
feature regardless of how simple it is. `webcredentials`/iCloud Keychain reuses credentials the
user's device and browser already manage, instead of Mobilio building and securing its own
biometric auth storage.

**Rejected:** A single uniform "connect your backend" model for every native feature —
rejected as unnecessary friction for features that don't need it.

See [[STATUS]].
