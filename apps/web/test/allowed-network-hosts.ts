// Shared by test/msw-policy.ts's MSW onUnhandledRequest policy — see msw-policy.ts for
// why that's the only place this is consulted (apps/web's setup.ts has no socket-level
// guard the way apps/api's does).
//
// Loopback-only, not "any private range" — apiClient.test.ts's own mocked requests
// target http://localhost:3011 (see API_BASE there), which the MSW catch-all must let
// through via passthrough() rather than erroring on, even though server.use()'s
// per-test handlers already intercept them before the catch-all ever runs.
const ALLOWED_NETWORK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isAllowedNetworkHost(host: unknown): boolean {
  if (typeof host !== 'string' || host.length === 0) return true; // no host (e.g. a unix socket path) — not a remote-network connection
  if (ALLOWED_NETWORK_HOSTS.has(host)) return true;
  return host.startsWith('127.'); // any loopback address in 127.0.0.0/8, not just 127.0.0.1
}
