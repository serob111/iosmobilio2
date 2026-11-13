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

// validatePreviewEnv also now requires PREVIEW_SLUG_KEY unconditionally (share links'
// raw slug must always be encryptable/decryptable for redisplay) — same default-only-
// if-unset reasoning as the two vars above. Fixed, not random, so test output (if ever
// printed) doesn't vary run to run; the exact bytes don't matter, only that there are 32
// of them.
process.env.PREVIEW_SLUG_KEY ??= Buffer.alloc(32, 7).toString('base64');

// --- Block real network for unit tests ---------------------------------------------
//
// Patches net.Socket.prototype.connect — the one chokepoint virtually every Node
// networking path (http/https, undici/global fetch, pg, ioredis, the AWS SDK) ultimately
// goes through to actually open a TCP connection — so a request that slips past a test's
// own mocking (MSW, vi.mock('node:dns/promises', ...), etc.) fails immediately with a
// clear error instead of silently hitting the real internet (or hanging on a DNS lookup
// that never resolves in a sandboxed CI runner).
//
// Deliberately NOT a dns.lookup patch: several integration specs already
// vi.mock('node:dns/promises', ...) to fake one specific test hostname while falling
// through to the real resolver (`actual.lookup`) for everything else — a dns-level guard
// here would either fight that pattern or get bypassed by it, since vi.mock's
// `importOriginal()` semantics around an already-mutated built-in module are unclear.
//
// Any connect() call made from *inside* @mswjs/interceptors' own socket machinery is
// always let through, unconditionally — confirmed by tracing it directly: even a fully
// *matched* MSW mock calls through to the real net.Socket/tls.TLSSocket connect (same
// hostname a genuine leak would use) as an internal implementation detail, and resolves
// in ~60ms with no real DNS/TCP activity at all (MSW substitutes the response entirely
// in-process). A connect()-layer guard can't tell that apart from a real leak by
// inspecting the call's arguments — matched or unmatched, mocked or genuinely bypassed,
// the call looks identical. What *can* tell them apart is whether MSW's own machinery is
// on the call stack at all — but that only works because every spec that talks to an
// external host is required to use test/msw-policy.ts's onUnhandledRequest callback
// (not the 'bypass'/'warn' string options, which let an unmatched request straight
// through to this same real connect() with no way for this guard to tell it apart from
// a matched one): that callback throws for anything outside this same allow-list,
// BEFORE the request ever reaches the socket layer, so a request that actually arrives
// here from inside MSW already passed that check.
import net from 'node:net';
import { isAllowedNetworkHost } from './allowed-network-hosts.js';

Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 50);

function extractHost(args: unknown[]): unknown {
  const first = args[0];
  if (first && typeof first === 'object' && 'host' in (first as Record<string, unknown>)) {
    return (first as { host?: unknown }).host;
  }
  // connect(port, host[, connectListener]) — host is the second positional arg.
  if (typeof args[1] === 'string') return args[1];
  return undefined;
}

function isCalledFromMsw(): boolean {
  const stack = new Error().stack ?? '';
  return stack.includes('@mswjs/interceptors') || stack.includes('@mswjs\\interceptors');
}

const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
  const host = extractHost(args);
  if (!isAllowedNetworkHost(host) && !isCalledFromMsw()) {
    throw new Error(
      `[test-network-guard] Blocked a real network connection to "${String(host)}" from a test. ` +
        'Only localhost/127.0.0.0-8/postgres/redis/minio are allowed — mock this request ' +
        '(MSW, vi.mock) instead of letting it reach the real network. ' +
        'See apps/api/test/setup.ts if this guard itself needs adjusting.',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwarding net.Socket.connect's own overloaded signature as-is
  return (originalSocketConnect as any).apply(this, args);
};
