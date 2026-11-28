# Decisions

One file per decision: date, decision, why, rejected alternatives. See [[STATUS]] for how
each decision maps to current progress, [[ARCHITECTURE]] for how the implemented ones fit
together.

- [[2026-10-16-shell-react-native-not-capacitor]] — shell on React Native/Expo, not Capacitor.
- [[2026-10-16-ios-first-android-after-beta]] — iOS first, Android after beta.
- [[2026-10-19-hetzner-vps-not-managed-cloud]] — own VPS (Hetzner), not Supabase or AWS.
- [[2026-10-20-multitenancy-postgres-rls]] — multi-tenancy via Postgres RLS, `mobilio_app`/`mobilio_migrator`.
- [[2026-10-23-anonymous-drafts-cookie-claim]] — anonymous drafts via httpOnly cookie, claimed after login.
- [[2026-10-28-preview-proxy-capability-slug]] — preview via capability-slug proxy on its own domain; editor/share split; PSL is the real boundary.
- [[2026-11-20-adhoc-icons-separate-png-js-splash]] — Ad Hoc icons as separate PNGs; brand splash in JS.
- [[2026-11-20-push-direct-apns]] — push notifications direct to APNs, not through Expo's push service.
- [[2026-11-21-repack-not-full-build-for-adhoc]] — repack instead of a full build, for test/Ad Hoc builds.
- [[2026-11-21-design-system-vivid]] — design system: Vivid.
- [[2026-11-22-adhoc-mobilio-account-appstore-client-account]] — test builds on Mobilio's Apple account; App Store publication on the client's own account.
- [[2026-11-22-payment-paddle-merchant-of-record]] — payment via Paddle as Merchant of Record.
- [[2026-11-22-native-features-three-tiers-faceid]] — native features without code, three tiers; Face ID via webcredentials + iCloud Keychain.
- [[2026-11-22-pricing-below-median-proposed]] — pricing slightly below median (proposed, not approved).
