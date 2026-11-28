# Ad Hoc icons as separate PNGs (CFBundleIconFiles); brand splash in JS, not a native launch screen

**Date:** 2026-11-20 (`fb17af4`/`89d415d`, removing the asset-catalog icon Xcode's `actool`
kept overriding) through 2026-11-21 (`52a144e`, generating client icons/splash from `sharp`
in `packages/repacker`).

**Decision:** For repacked (Ad Hoc) builds, app icons are patched in as loose PNG files
referenced via `CFBundleIconFiles` in Info.plist, not by regenerating the compiled
`Assets.car` asset catalog. The branded splash screen is rendered from JavaScript on app
start, not baked into a native `LaunchScreen` storyboard/asset.

**Why:** `Assets.car` is a compiled binary asset catalog — building one requires Xcode's
`actool`, which only runs on macOS; the repack pipeline runs on an ordinary Linux box
specifically to avoid needing a Mac per build ([[2026-11-21-repack-not-full-build-for-adhoc]]).
Loose PNGs plus `CFBundleIconFiles` is an Info.plist-level change, patchable without any
native toolchain at all. The same constraint applies to a native launch screen — it's also a
compiled asset — so the branded splash is drawn by JS once the app's JS runtime starts
instead.

**Rejected:** Regenerating `Assets.car` per client (would need a macOS step in an otherwise
Mac-free pipeline, defeating the point of repacking); a native launch screen (same problem,
plus `fb17af4` found Xcode's `actool` kept silently overriding a loose icon file placed next
to a stale asset catalog — removing the asset catalog closed that collision for good).

See [[STATUS]].
