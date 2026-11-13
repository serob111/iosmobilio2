import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent } from 'undici';
import { resolveSafeAddresses, pinnedLookup } from '../../net/safe-fetch.js';
import { isUrlHostAllowed, type HostAllowlist } from './host-allowlist.js';
import { createSizeLimitStream } from './response-size-limit.js';

// Same reasoning as net/safe-fetch.ts: looked up live at call time (not a captured
// module-level const) so MSW's Node FetchInterceptor — which patches globalThis.fetch,
// not undici's own exported fetch — can see calls made through this module in tests.
type FetchWithDispatcher = (url: string | URL, init: RequestInit & { dispatcher?: Agent }) => Promise<Response>;
function fetchWithDispatcher(url: string | URL, init: RequestInit & { dispatcher?: Agent }): Promise<Response> {
  return (globalThis.fetch as FetchWithDispatcher)(url, init);
}

export type ProxyFetchErrorCode =
  | 'UNSAFE_URL'
  | 'TOO_MANY_REDIRECTS'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'SITE_UNREACHABLE';

export class ProxyFetchError extends Error {
  constructor(
    public readonly code: ProxyFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProxyFetchError';
  }
}

export type ProxyFetchResult = {
  status: number;
  headers: Headers;
  body: Readable;
  finalUrl: string;
};

/**
 * `external-redirect` is not an error: a redirect to a host outside the project's own
 * allowlist is an expected, legitimate thing for a real site to do (checkout handoff to a
 * payment provider, a social login redirect, …) — the proxy just can't follow it. The
 * caller renders an interstitial page with a target=_blank link to the real destination
 * instead of silently failing or (worse) fetching a third-party site through our proxy.
 */
export type ProxyFetchOutcome =
  | { kind: 'ok'; result: ProxyFetchResult }
  | { kind: 'external-redirect'; location: string };

export type ProxyFetchOptions = {
  method: 'GET' | 'HEAD';
  allowlist: HostAllowlist;
  /** Hard cap on response body size — the stream is destroyed, not just stopped-reading, once exceeded. */
  maxBodyBytes: number;
  timeoutMs?: number;
  /** Default 5 — caps *allowed* (same-allowlist) redirect hops. A hop outside the allowlist returns 'external-redirect' immediately, it doesn't count against this. */
  maxRedirects?: number;
  allowedContentTypePrefixes?: string[];
  /** Test-only escape hatch — see net/safe-fetch.ts's option of the same name. */
  allowAddressesForTesting?: readonly string[];
  /** Test-only escape hatch — see net/safe-fetch.ts's option of the same name. */
  allowAnyPortForTesting?: boolean;
};

function validateUrlStructure(url: URL, allowAnyPort: boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyFetchError('UNSAFE_URL', `Protocol not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new ProxyFetchError('UNSAFE_URL', 'Credentials in url are not allowed');
  }
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (!allowAnyPort && url.port && url.port !== defaultPort) {
    throw new ProxyFetchError('UNSAFE_URL', `Port not allowed: ${url.port}`);
  }
}

/**
 * The only way the preview proxy may fetch a project/draft's own site. Two gates apply to
 * every hop, not just the first: isUrlHostAllowed (the actual security boundary — only
 * the one site this specific preview link belongs to) and resolveSafeAddresses (defense
 * in depth against that same site's DNS pointing at a private address, including
 * mid-request rebinding — the connection is pinned to whatever address passed the check,
 * exactly like net/safe-fetch.ts). A redirect outside the allowlist is reported back to
 * the caller rather than followed or treated as an error.
 *
 * Unlike safeFetch, this returns a streamed body (not a buffered one) — the caller pipes
 * it through the HTML/CSS rewriter and the 10MB cap is enforced progressively as bytes
 * arrive, not after fully buffering the response first.
 */
export async function proxyFetch(targetUrl: string, options: ProxyFetchOptions): Promise<ProxyFetchOutcome> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const validatedByHost = new Map<string, LookupAddress[]>();
  const agent = new Agent({ connect: { lookup: pinnedLookup(validatedByHost) } });

  // Cleared once the caller is done with the response: immediately for a rejected/
  // non-2xx-without-body outcome, or once the streamed body ends/errors/closes for an
  // 'ok' outcome — never in a plain `finally` here, since the body is still being read
  // by the caller well after this function itself returns.
  let settled = false;
  function cleanup(): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    agent.close().catch(() => {});
  }

  try {
    let currentUrl: URL;
    try {
      currentUrl = new URL(targetUrl);
    } catch {
      throw new ProxyFetchError('UNSAFE_URL', `Invalid url: ${targetUrl}`);
    }
    if (!isUrlHostAllowed(currentUrl, options.allowlist)) {
      throw new ProxyFetchError('UNSAFE_URL', `Host not allowed: ${currentUrl.hostname}`);
    }

    let redirectCount = 0;
    while (true) {
      validateUrlStructure(currentUrl, options.allowAnyPortForTesting ?? false);
      const addresses = await resolveSafeAddresses(currentUrl.hostname, dnsLookup, options.allowAddressesForTesting);
      validatedByHost.set(currentUrl.hostname, addresses);

      let response: Response;
      try {
        response = await fetchWithDispatcher(currentUrl, {
          method: options.method,
          redirect: 'manual',
          signal: controller.signal,
          dispatcher: agent,
        });
      } catch (error) {
        if (error instanceof ProxyFetchError) throw error;
        throw new ProxyFetchError('SITE_UNREACHABLE', `Request failed: ${(error as Error).message}`);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        // Cancel before following/reporting — a redirect response can still carry a
        // body, and leaving it unconsumed holds its connection open.
        await response.body?.cancel().catch(() => {});
        if (!location) {
          throw new ProxyFetchError('SITE_UNREACHABLE', 'Redirect response with no Location header');
        }
        const nextUrl = new URL(location, currentUrl);
        if (!isUrlHostAllowed(nextUrl, options.allowlist)) {
          cleanup();
          return { kind: 'external-redirect', location: nextUrl.toString() };
        }
        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          throw new ProxyFetchError('TOO_MANY_REDIRECTS', `Exceeded ${maxRedirects} redirects`);
        }
        currentUrl = nextUrl;
        continue;
      }

      if (options.allowedContentTypePrefixes) {
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        const allowed = options.allowedContentTypePrefixes.some((prefix) =>
          contentType.startsWith(prefix.toLowerCase()),
        );
        if (!allowed) {
          await response.body?.cancel().catch(() => {});
          throw new ProxyFetchError('UNSUPPORTED_CONTENT_TYPE', `Content-Type not allowed: ${contentType}`);
        }
      }

      const body = streamBody(response.body, options.maxBodyBytes, cleanup);
      return {
        kind: 'ok',
        result: { status: response.status, headers: response.headers, body, finalUrl: currentUrl.toString() },
      };
    }
  } catch (error) {
    cleanup();
    throw error;
  }
}

function streamBody(webBody: ReadableStream<Uint8Array> | null, maxBytes: number, onDone: () => void): Readable {
  if (!webBody) {
    queueMicrotask(onDone);
    return Readable.from([]);
  }
  const source = Readable.fromWeb(webBody as never);
  const output = new PassThrough();
  pipeline(source, createSizeLimitStream(maxBytes), output).catch(() => {
    // pipeline already destroys `output` with this same error on failure — the caller
    // observes it via output's own 'error' event, nothing further to do here. Swallowed
    // only to avoid an unhandled-rejection warning on this detached promise.
  });
  output.once('close', onDone);
  return output;
}
