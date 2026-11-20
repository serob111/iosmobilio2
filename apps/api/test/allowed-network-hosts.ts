// Shared by test/setup.ts's net.Socket.prototype.connect guard and test/msw-policy.ts's
// MSW onUnhandledRequest policy — one definition of "what counts as local infra" so the
// two can never quietly drift apart and disagree about what a leak is.
//
// Loopback-only, not "any private range" — every docker-compose service (Postgres,
// Redis, MinIO) this test suite's own live-service specs connect to is reached via its
// exposed host port on localhost/127.0.0.1 (see every DATABASE_URL/REDIS_URL/S3_ENDPOINT
// default in this repo), never by the compose service name directly, since the test
// process itself always runs on the host, not inside the compose network. The three
// compose service names are allowed too, defensively, in case that ever changes.
const ALLOWED_NETWORK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'redis', 'minio']);

export function isAllowedNetworkHost(host: unknown): boolean {
  if (typeof host !== 'string' || host.length === 0) return true; // no host (e.g. a unix socket path) — not a remote-network connection
  if (ALLOWED_NETWORK_HOSTS.has(host)) return true;
  return host.startsWith('127.'); // any loopback address in 127.0.0.0/8, not just 127.0.0.1
}
