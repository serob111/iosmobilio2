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
