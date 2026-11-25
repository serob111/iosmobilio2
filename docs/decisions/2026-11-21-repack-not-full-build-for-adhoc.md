# Repack instead of a full build, for test/Ad Hoc builds

**Date:** 2026-11-21 (`d6e2822`, `packages/repacker` scaffold — the first implementation
commit; the decision itself was made earlier, mid-Этап-2, superseding an even older
"template + config-plugin" spec that was never built).

**Decision:** For Ad Hoc/test builds, unzip one pre-built shell `.ipa`, patch
config/icon/splash/entitlements/Info.plist in place, re-sign with `rcodesign` on an ordinary
Linux box, re-zip — target under 2 minutes end-to-end. App Store submissions still go
through a full macOS build (`xcodebuild archive` via GitHub Actions).

**Why:** A full `expo prebuild` + `xcodebuild archive` run takes ~10-11 minutes and requires
a macOS runner for every single client build — fine for the rare App Store submission, too
slow and too expensive for the fast iterate-and-test loop a client needs while still deciding
on their app. Repacking a single already-built, already-signed-shape shell template is a
file-patching problem, not a compile problem, so it can run anywhere (no Mac needed) and
finish in roughly the time it takes to download/re-upload the `.ipa`.

**Rejected:** A custom Xcode-resource-injection config plugin to get loose config/icon files
into a compiled `.app` without recompiling (the original spec) — dropped once "just rebuild
in CI" proved simpler for the real build path; "always do a full macOS CI build, even for
quick tests" — too slow for the iterate loop this is meant to serve.

See [[STATUS]], [[ARCHITECTURE]].
