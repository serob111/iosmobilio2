// Mirrors apps/api/test/allowed-network-hosts.ts and apps/web/test/allowed-network-hosts.ts
// verbatim — shared by test/setup.ts's net.Socket.prototype.connect guard and
// test/msw-policy.ts's MSW catch-all handler, so the two can never quietly drift apart
// and disagree about what a leak is. Not re-exported from one of those packages
// because packages/apple doesn't depend on apps/api or apps/web (and shouldn't).
const ALLOWED_NETWORK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'redis', 'minio']);

export function isAllowedNetworkHost(host: unknown): boolean {
  if (typeof host !== 'string' || host.length === 0) return true; // no host (e.g. a unix socket path) — not a remote-network connection
  if (ALLOWED_NETWORK_HOSTS.has(host)) return true;
  return host.startsWith('127.'); // any loopback address in 127.0.0.0/8, not just 127.0.0.1
}
