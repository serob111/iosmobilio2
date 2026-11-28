// Registered via vitest.config.ts's test.setupFiles — runs once before every test file.
//
// --- Block real network for unit tests ---------------------------------------------
//
// Mirrors apps/api/test/setup.ts's own guard (minus that file's api-specific env
// defaults, which don't apply here). Patches net.Socket.prototype.connect — the one
// chokepoint virtually every Node networking path (http/https, undici/global fetch)
// ultimately goes through to actually open a TCP connection — so a request that slips
// past a test's own mocking (MSW) fails immediately with a clear error instead of
// silently hitting the real internet (or hanging on a DNS lookup that never resolves in
// a sandboxed CI runner).
//
// Any connect() call made from *inside* @mswjs/interceptors' own socket machinery is
// always let through, unconditionally — even a fully *matched* MSW mock calls through
// to the real net.Socket/tls.TLSSocket connect as an internal implementation detail,
// resolving in-process with no real DNS/TCP activity. A connect()-layer guard can't tell
// that apart from a real leak by inspecting the call's arguments alone — what can tell
// them apart is whether MSW's own machinery is on the call stack, which only works
// because test/mocks/server.ts registers test/msw-policy.ts's catch-all handler as
// setupServer()'s own initial handler: every request matches *something* now, so a
// request arriving here from inside MSW already passed that check.
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
        'Only localhost/127.0.0.0-8/postgres/redis/minio are allowed — mock this request (MSW) ' +
        'instead of letting it reach the real network. See packages/apple/test/setup.ts if this ' +
        'guard itself needs adjusting.',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwarding net.Socket.connect's own overloaded signature as-is
  return (originalSocketConnect as any).apply(this, args);
};
