# Test builds on Mobilio's Apple account (Ad Hoc); App Store publication on the client's own account

**Date:** 2026-11-22 (`ca30263`, `ensureAdHocProfile`; `9ce9a40`, App Store Connect API
client).

**Decision:** Ad Hoc test builds (up to 2 iPhones per test — well under Apple's 100-device/
year Ad Hoc cap) are provisioned and signed under Mobilio's own Apple Developer account.
Publishing to the App Store for real happens under the **client's** Apple Developer account,
not Mobilio's.

**Why:** Apple's Ad Hoc device cap (100 UDIDs/year, non-resettable) is shared across every
app signed under one account — if every client's test builds consumed Mobilio's own cap,
it would run out fast across many clients. Keeping Ad Hoc testing on Mobilio's account while
registering only 1-2 devices per test keeps that cap healthy indefinitely. App Store listings,
on the other hand, legally and practically belong to the client (their business name, their
support contact, their App Store Connect account) — Mobilio publishing apps under its own
account on the client's behalf would mean Mobilio owns every listing it ships, which doesn't
match who actually owns the business the app represents.

**Rejected:** Running Ad Hoc tests under each client's own account (would require provisioning
every client with their own Apple Developer membership just to see a test build — too much
friction before a client has even decided to buy); publishing to the App Store under
Mobilio's account (wrong ownership model for a client-facing product).

See [[STATUS]].
