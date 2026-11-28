# Shell on React Native/Expo, not Capacitor

**Date:** 2026-10-16 (project inception — `apps/shell` is Expo from the very first commit,
`cf7ea2d`; no Capacitor version was ever built).

**Decision:** Build the native iOS shell with React Native/Expo (SDK 57, expo-router), not
Capacitor (a WebView wrapper around the client's own site).

**Why:** Apple App Review scrutinizes apps that are "just a WebView around a website" and
rejects or delists them more readily than genuine native apps. A React Native shell with a
real native navigation/tab structure, native push registration, and native UI chrome around
the embedded web content reads as a real app to review, not a wrapped browser tab — the
single biggest risk to get through App Store review repeatedly, across many near-identical
client apps, is exactly this kind of rejection.

**Rejected:** Capacitor — faster to wrap a site, but the "thin WebView wrapper" pattern is a
known App Review red flag, and Mobilio needs this to work for many similar apps without each
one individually risking rejection.

See [[STATUS]], [[ARCHITECTURE]].
