# iOS first, Android after beta

**Date:** 2026-10-16 (approximate — a product-scope decision that predates any trackable
commit; the repo has never contained Android build tooling beyond Expo's default scaffold).

**Decision:** Build and ship iOS only through the Ad Hoc and App Store phases. Android is
explicitly out of scope until after the iOS beta.

**Why:** iOS is the harder, more constrained platform (App Review, provisioning
profiles/certificates, Ad Hoc's 100-device/year cap, repack/re-signing complexity) — solving
it first means the repack pipeline, Ad Hoc distribution, and App Store submission flow all
get validated against the stricter platform. Android's distribution model (APK sideloading,
Play Store review) is comparatively permissive, so it adds little risk validation and can
wait without blocking anything on the iOS side.

**Rejected:** Building both platforms in parallel — would split effort across two repack/sign
pipelines before either one is proven out.

See [[STATUS]].
