// Registered via vitest.config.ts's test.setupFiles — runs once before every test file.
// Integration specs that boot a real app via createApp() (drafts/projects/auth-flow/
// organizations-race) don't exercise the builds feature at all and never set
// BUILD_RUNNER themselves; without a default here, validateBuildEnv (see
// src/builds/validate-build-env.ts) would refuse to let createApp() succeed for all of
// them, since BUILD_RUNNER defaults to "github" and none of GITHUB_DISPATCH_TOKEN/
// API_PUBLIC_URL/BUILD_TOKEN_KEY are set in a plain test run. Only a default — a real
// env var (CI, .env) always wins, and builds.integration.spec.ts still sets/clears its
// own value explicitly since it actually exercises BUILD_RUNNER=fake's behavior.
process.env.BUILD_RUNNER ??= 'fake';

// Same reasoning as BUILD_RUNNER above: validatePreviewEnv (src/preview/validate-preview-env.ts)
// now also runs on every createApp() call and refuses to start without
// PREVIEW_PROXY_DOMAIN set to a different registrable domain than WEB_ORIGIN. Most
// integration specs don't exercise the preview proxy at all, so give them a sane default —
// one that also can't collide with the preview proxy middleware's own host-based gate in
// create-app.ts, which 404s every request whose Host falls within PREVIEW_PROXY_DOMAIN's
// zone (the bare domain or any subdomain of it). supertest/undici requests against a
// local test server always arrive with Host "127.0.0.1:<port>" or "localhost:<port>", so
// this uses "preview.invalid" (RFC 2606 reserved, guaranteed to never be a real/
// resolvable hostname, and never a suffix of "127.0.0.1"/"localhost" either) to guarantee
// it never matches those and never accidentally 404s an ordinary integration test's own
// requests.
process.env.PREVIEW_PROXY_DOMAIN ??= 'preview.invalid';
