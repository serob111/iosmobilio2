# Push notifications direct to APNs, not through Expo's push service

**Date:** 2026-11-20 (`9ade032`, "register with the raw APNs device token, not Expo's push
service").

**Decision:** The shell registers its raw APNs device token
(`getDevicePushTokenAsync`) and `apps/api` sends pushes straight to Apple's APNs, instead of
going through Expo's hosted push notification service.

**Why:** Expo's push service is a convenience layer that still ultimately forwards to APNs —
adding it as a middleman means a second service (and a second potential outage/rate-limit/
account) between Mobilio and every push it sends, for apps that are already fully owned and
signed by Mobilio's own pipeline (bundle IDs, provisioning, push entitlements all managed
in-house via `packages/apple`). Going direct removes that dependency and keeps push delivery
entirely inside infrastructure Mobilio already controls.

**Rejected:** Expo's push service — simpler to integrate initially, but an unnecessary
third-party hop for a pipeline that already manages its own Apple credentials end-to-end.

See [[STATUS]].
