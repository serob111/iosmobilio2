import net from 'node:net';
import type { LookupFunction } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { Agent } from 'undici';
import { isForbiddenIp } from './ip-policy.js';

// Opt-in, env-gated escape hatch for tests that need safeFetch/proxyFetch to reach a
// REAL local server (e.g. to prove gzip/br/deflate actually round-trips through a real
// undici fetch, not a mocked one) — a real external test site isn't an option (no
// outbound internet access in CI/sandboxes), and MSW can't exercise real transport-level
// compression at all (nothing is really compressed when the network layer is mocked).
// Scoped to exactly 127.0.0.1/::1, not a blanket "allow all private" — the SSRF
// allowlist/DNS-pinning defenses stay fully in effect for everything else.
//
// Deliberately read fresh on every call (never captured into a module-level const) —
// a test that sets this env var at its own module's top level runs that assignment
// *after* all of its imports have already been evaluated (ESM import hoisting), so a
// frozen-at-import-time value here would silently see the pre-assignment default and
// never pick up the override at all.
function allowLocalForTesting(): boolean {
  return process.env.SAFE_FETCH_ALLOW_LOCAL_FOR_TESTING === 'true';
}

export function getSafeFetchTestOverrides(): {
  allowAddressesForTesting: readonly string[];
  allowAnyPortForTesting: boolean;
} {
  return allowLocalForTesting()
    ? { allowAddressesForTesting: ['127.0.0.1', '::1'], allowAnyPortForTesting: true }
    : { allowAddressesForTesting: [], allowAnyPortForTesting: false };
}

/**
 * Called once at app bootstrap, same timing/rationale as validateBuildEnv() — refuses to
 * start if this escape hatch is enabled in production, exactly like BUILD_RUNNER=fake.
 */
export function validateSafeFetchTestEnv(): void {
  if (allowLocalForTesting() && process.env.NODE_ENV === 'production') {
    throw new Error('SAFE_FETCH_ALLOW_LOCAL_FOR_TESTING=true is not allowed when NODE_ENV=production');
  }
}

// The global `fetch` (undici-backed) is used deliberately, not undici's own exported
// `fetch` — MSW's node FetchInterceptor patches `globalThis.fetch` specifically, and
// explicitly says it does NOT see requests made through undici's own client/fetch
// export. Looked up fresh at call time (not captured into a module-level const) because
// MSW's patch is installed by `server.listen()` at test-run time, after this module has
// already been imported — a captured reference would freeze in the pre-patch original.
type FetchWithDispatcher = (
  url: string | URL,
  init: RequestInit & { dispatcher?: Agent },
) => Promise<Response>;
function fetchWithDispatcher(
  url: string | URL,
  init: RequestInit & { dispatcher?: Agent },
): Promise<Response> {
  return (globalThis.fetch as FetchWithDispatcher)(url, init);
}

export type SafeFetchErrorCode =
  | 'UNSAFE_URL'
  | 'TOO_MANY_REDIRECTS'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'SITE_UNREACHABLE';

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export type SafeFetchOptions = {
  /** Hard cap on response body size — the stream is cancelled, not just truncated, once exceeded. */
  maxBodyBytes: number;
  timeoutMs?: number;
  /** Default 5 — caps the number of redirect hops this call will follow. */
  maxRedirects?: number;
  /** If given, the final response's Content-Type must start with one of these (case-insensitive). */
  allowedContentTypePrefixes?: string[];
  /**
   * Test-only escape hatch: specific IP literals that bypass the forbidden-range check
   * even though they'd otherwise be rejected (e.g. a loopback address a local test
   * server binds to, to prove the real connection-pinning behavior end-to-end). No
   * production code path sets this — see safe-fetch.binding.spec.ts for the one place
   * it's actually used.
   */
  allowAddressesForTesting?: readonly string[];
  /**
   * Test-only escape hatch: skips the port-80/443 check. A real test server can't bind
   * privileged port 80 without root, so the binding test above needs an ephemeral port —
   * this does not weaken the address-range check, which still applies independently.
   */
  allowAnyPortForTesting?: boolean;
};

export type SafeFetchResult = {
  status: number;
  headers: Headers;
  body: Buffer;
  finalUrl: string;
};

function validateUrlStructure(url: URL, allowAnyPort: boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('UNSAFE_URL', `Protocol not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SafeFetchError('UNSAFE_URL', 'Credentials in url are not allowed');
  }
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (!allowAnyPort && url.port && url.port !== defaultPort) {
    throw new SafeFetchError('UNSAFE_URL', `Port not allowed: ${url.port}`);
  }
}

/**
 * Resolves `hostname` and validates every address it maps to — not just the first one.
 * A hostname that resolves to a mix of public and internal addresses is rejected
 * outright: an attacker who controls round-robin DNS could otherwise get the "public"
 * answer during this check and the "internal" one at actual connect time.
 *
 * `lookup` is injectable so SSRF-scenario tests can supply a controlled resolver instead
 * of depending on real DNS (which can't deterministically return a private address).
 */
export async function resolveSafeAddresses(
  hostname: string,
  lookup: typeof dnsLookup = dnsLookup,
  allowAddresses: readonly string[] = [],
): Promise<LookupAddress[]> {
  // WHATWG URL.hostname keeps the brackets for an IPv6 literal (e.g. "[::1]") — net.isIP
  // and isForbiddenIp both expect a bare address, so strip them before any literal-IP check.
  const bareHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const literalVersion = net.isIP(bareHost);
  if (literalVersion !== 0) {
    if (isForbiddenIp(bareHost) && !allowAddresses.includes(bareHost)) {
      throw new SafeFetchError('UNSAFE_URL', `IP address is not allowed: ${bareHost}`);
    }
    return [{ address: bareHost, family: literalVersion }];
  }

  // Bare hostnames (no dot) are almost always internal — Docker Compose service names
  // (minio, postgres), "localhost", single-label intranet hosts. None of this app's
  // legitimate targets are single-label, so this is a cheap reject before even trying DNS.
  if (!hostname.includes('.')) {
    throw new SafeFetchError(
      'UNSAFE_URL',
      `Host must be a fully-qualified domain name: ${hostname}`,
    );
  }

  let records: LookupAddress[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new SafeFetchError('SITE_UNREACHABLE', `Could not resolve host: ${hostname}`);
  }
  if (records.length === 0) {
    throw new SafeFetchError('SITE_UNREACHABLE', `Host has no addresses: ${hostname}`);
  }
  for (const record of records) {
    if (isForbiddenIp(record.address) && !allowAddresses.includes(record.address)) {
      throw new SafeFetchError(
        'UNSAFE_URL',
        `Host resolves to a disallowed address: ${record.address}`,
      );
    }
  }
  return records;
}

/**
 * A `lookup` implementation for undici's `connect` options that returns only the
 * addresses already validated for a given hostname, instead of re-resolving it —
 * the actual TCP connection is pinned to what was checked, so a DNS answer that changes
 * between validation and connection (rebinding) can't redirect the request anywhere else.
 * Exported so other safe-fetch-shaped callers (the preview proxy) that can't reuse
 * `safeFetch` itself end-to-end — e.g. because they need a streamed body, or their own
 * redirect-following rules — still get the identical connection-pinning guarantee rather
 * than a second, divergent copy of this logic.
 */
export function pinnedLookup(validatedByHost: Map<string, LookupAddress[]>): LookupFunction {
  return (hostname, options, callback) => {
    const addresses = validatedByHost.get(hostname);
    if (!addresses) {
      callback(new Error(`No pre-validated address for host: ${hostname}`), '');
      return;
    }
    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0]!.address, addresses[0]!.family);
    }
  };
}

async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError('RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * The only way user-supplied URLs (site analysis, icon downloads, and later the preview
 * proxy) may be fetched — never call the global `fetch` directly with one (see
 * eslint.config.js's no-restricted-globals rule for `fetch`). Validates scheme/port/
 * credentials, resolves and checks every address a hostname maps to, pins the actual
 * connection to those addresses, and re-validates every redirect hop the same way.
 */
export async function safeFetch(
  inputUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const validatedByHost = new Map<string, LookupAddress[]>();
  const agent = new Agent({ connect: { lookup: pinnedLookup(validatedByHost) } });

  try {
    let currentUrl: URL;
    try {
      currentUrl = new URL(inputUrl);
    } catch {
      throw new SafeFetchError('UNSAFE_URL', `Invalid url: ${inputUrl}`);
    }

    let redirectCount = 0;
    while (true) {
      validateUrlStructure(currentUrl, options.allowAnyPortForTesting ?? false);
      const addresses = await resolveSafeAddresses(
        currentUrl.hostname,
        dnsLookup,
        options.allowAddressesForTesting,
      );
      validatedByHost.set(currentUrl.hostname, addresses);

      let response: Response;
      try {
        response = await fetchWithDispatcher(currentUrl, {
          redirect: 'manual',
          signal: controller.signal,
          dispatcher: agent,
        });
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        throw new SafeFetchError('SITE_UNREACHABLE', `Request failed: ${(error as Error).message}`);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        // Cancel before following — a redirect response can still carry a body (e.g. an
        // HTML page explaining the redirect), and leaving it unconsumed holds its
        // connection open instead of releasing it back to the agent.
        await response.body?.cancel();
        if (!location) {
          throw new SafeFetchError('SITE_UNREACHABLE', 'Redirect response with no Location header');
        }
        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          throw new SafeFetchError('TOO_MANY_REDIRECTS', `Exceeded ${maxRedirects} redirects`);
        }
        currentUrl = new URL(location, currentUrl);
        continue;
      }

      if (options.allowedContentTypePrefixes) {
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        const allowed = options.allowedContentTypePrefixes.some((prefix) =>
          contentType.startsWith(prefix.toLowerCase()),
        );
        if (!allowed) {
          throw new SafeFetchError(
            'UNSUPPORTED_CONTENT_TYPE',
            `Content-Type not allowed: ${contentType}`,
          );
        }
      }

      const body = await readLimited(response.body, options.maxBodyBytes);
      return {
        status: response.status,
        headers: response.headers,
        body,
        finalUrl: currentUrl.toString(),
      };
    }
  } finally {
    clearTimeout(timer);
    await agent.close();
  }
}
