import type { Request, Response, NextFunction } from 'express';
import { Readable } from 'node:stream';
import { getClientRateLimitKey } from '../../common/rate-limit-key.js';
import { PreviewLinkService } from '../preview-link.service.js';
import { hashPreviewSlug } from '../preview-slug.js';
import { previewProxyDomain } from '../validate-preview-env.js';
import { ProxyRateLimitService } from './proxy-rate-limit.js';
import { ProxyCacheService } from './proxy-cache.js';
import { deriveHostAllowlist, isHostAllowed, type HostAllowlist } from './host-allowlist.js';
import { proxyFetch, ProxyFetchError } from './proxy-fetch.js';
import { getSafeFetchTestOverrides } from '../../net/safe-fetch.js';
import { ResponseTooLargeError } from './response-size-limit.js';
import { buildProxyResponseHeaders } from './header-filter.js';
import { createHtmlRewriteStream } from './html-rewriter.js';
import { rewriteCss } from './css-rewriter.js';
import { renderExternalLinkPage } from './external-link-page.js';
import { HOST_OVERRIDE_QUERY_KEY } from './rewrite-url.js';
import { extractPreviewSlugFromHost, isWithinPreviewProxyDomain } from './preview-host.js';
import { detectCharset, decodeToUtf8, withCharset } from './charset.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const ALLOWED_CONTENT_TYPE_PREFIXES = [
  'text/html',
  'text/css',
  'application/javascript',
  'text/javascript',
  'application/json',
  'image/',
  'font/',
  'application/font-woff',
  'application/vnd.ms-fontobject',
  'application/x-font-ttf',
  'application/x-font-opentype',
];

function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? 'http://localhost:3000';
}

function readAll(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function rewriteHtmlBuffer(buffer: Buffer, allowlist: HostAllowlist, currentPageUrl: URL): Promise<Buffer> {
  const source = Readable.from([buffer.toString('utf8')]);
  source.setEncoding('utf8');
  const rewriter = createHtmlRewriteStream({ allowlist, currentPageUrl, primaryHost: allowlist.baseHost });
  source.pipe(rewriter);
  const chunks: string[] = [];
  for await (const chunk of rewriter) {
    chunks.push(chunk as string);
  }
  return Buffer.from(chunks.join(''), 'utf8');
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    result[name] = value;
  }
  return result;
}

export type PreviewProxyMiddlewareDeps = {
  previewLinkService: PreviewLinkService;
  rateLimit: ProxyRateLimitService;
  cache: ProxyCacheService;
};

/**
 * Every preview answers on its own origin, `https://<slug>.<PREVIEW_PROXY_DOMAIN>` — a
 * plain Express middleware (not a Nest controller) mounted directly in create-app.ts via
 * `app.use(...)`, the same pattern already used there for Better Auth's handler. A Nest
 * controller can't express "match this path, but only on this specific Host" on its own;
 * a bare catch-all route would shadow every other controller's routes regardless of host
 * unless something gates it first — so the gating (and the handling) both happen here,
 * before Nest's own router ever sees a proxy-zone request. For any request OUTSIDE
 * PREVIEW_PROXY_DOMAIN's zone, this calls `next()` immediately and Nest's normal routing
 * proceeds completely unaffected.
 *
 * Every response is fully buffered (bounded by MAX_BODY_BYTES, enforced progressively by
 * proxyFetch's own size-limit stream — never buffered-then-checked) before being sent:
 * HTML/CSS need their full body in hand to rewrite anyway, and buffering the rest keeps
 * one code path for "maybe rewrite, maybe cache, then send" instead of a separate
 * true-streaming path that would still need to special-case HTML/CSS.
 */
export function createPreviewProxyMiddleware(deps: PreviewProxyMiddlewareDeps) {
  return async function previewProxyMiddleware(request: Request, response: Response, next: NextFunction): Promise<void> {
    const proxyDomain = previewProxyDomain();
    const hostHeader = request.headers.host;
    if (!isWithinPreviewProxyDomain(hostHeader, proxyDomain)) {
      next();
      return;
    }
    const slug = extractPreviewSlugFromHost(hostHeader, proxyDomain);
    if (!slug) {
      // Anywhere within PREVIEW_PROXY_DOMAIN's own zone (the bare domain, a malformed or
      // nested subdomain) is proxy territory with nothing legitimate to fall back to —
      // never `next()` here, the main api's routes must never answer on this domain.
      response.status(404).end();
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.status(405).end();
      return;
    }

    const rateLimitKey = getClientRateLimitKey(request);
    const allowed = await deps.rateLimit.checkAndIncrement(slug, rateLimitKey);
    if (!allowed) {
      response.status(429).send('Слишком много запросов. Попробуйте позже.');
      return;
    }

    const source = await deps.previewLinkService.resolveProxySource(slug);
    if (!source) {
      response.status(404).json({ code: 'PREVIEW_NOT_FOUND', message: 'Preview not found' });
      return;
    }
    const allowlist = deriveHostAllowlist(source.sourceUrl);
    if (!allowlist) {
      response.status(502).json({ code: 'PREVIEW_SOURCE_INVALID', message: 'Preview source is misconfigured' });
      return;
    }

    // Never the raw slug — see proxy-cache.ts's own comment for why: a Redis key should
    // never carry the literal capability token a preview link's security rests on.
    const slugHash = hashPreviewSlug(slug);
    const path = request.path;
    const rawQuery = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';

    if (request.method === 'GET') {
      const cached = await deps.cache.get(slugHash, path, rawQuery);
      if (cached) {
        response.status(cached.status);
        for (const [name, value] of Object.entries(cached.headers)) {
          response.setHeader(name, value);
        }
        response.send(Buffer.from(cached.bodyBase64, 'base64'));
        return;
      }
    }

    const hostOverrideRaw = typeof request.query[HOST_OVERRIDE_QUERY_KEY] === 'string' ? request.query[HOST_OVERRIDE_QUERY_KEY] : undefined;
    const sourceUrlObj = new URL(source.sourceUrl);
    const scheme = sourceUrlObj.protocol;
    // .port is '' for the scheme's default port — source.url only ever carries a
    // non-default port when SAFE_FETCH_ALLOW_LOCAL_FOR_TESTING bypassed analyze-site's
    // own default-port-only check at creation time (real sites always analyze as
    // port-free/default), but dropping it unconditionally here would silently point the
    // fetch at the wrong port whenever that ever isn't true. Assumed shared across the
    // primary host and any allowed override subdomain — this proxy has no way to learn a
    // *different* port per subdomain, and real sites don't split traffic that way.
    const targetHost =
      hostOverrideRaw && isHostAllowed(hostOverrideRaw, allowlist) ? hostOverrideRaw.toLowerCase() : allowlist.baseHost;
    const targetAuthority = sourceUrlObj.port ? `${targetHost}:${sourceUrlObj.port}` : targetHost;
    const upstreamQuery = new URLSearchParams(rawQuery);
    upstreamQuery.delete(HOST_OVERRIDE_QUERY_KEY);
    const upstreamQueryString = upstreamQuery.toString();
    const targetUrl = `${scheme}//${targetAuthority}${path}${upstreamQueryString ? `?${upstreamQueryString}` : ''}`;

    let outcome;
    try {
      outcome = await proxyFetch(targetUrl, {
        method: request.method as 'GET' | 'HEAD',
        allowlist,
        maxBodyBytes: MAX_BODY_BYTES,
        timeoutMs: TIMEOUT_MS,
        allowedContentTypePrefixes: ALLOWED_CONTENT_TYPE_PREFIXES,
        ...getSafeFetchTestOverrides(),
      });
    } catch (error) {
      sendFetchError(response, error);
      return;
    }

    if (outcome.kind === 'external-redirect') {
      const headers = buildProxyResponseHeaders(new Headers(), webOrigin());
      response.status(200);
      response.setHeader('content-type', 'text/html; charset=utf-8');
      for (const [name, value] of headers.entries()) {
        if (name === 'content-type') continue;
        response.setHeader(name, value);
      }
      response.send(renderExternalLinkPage(outcome.location));
      return;
    }

    const { result } = outcome;
    let body: Buffer;
    try {
      body = await readAll(result.body);
    } catch (error) {
      sendFetchError(response, error);
      return;
    }

    const contentType = (result.headers.get('content-type') ?? '').toLowerCase();
    const currentPageUrl = new URL(result.finalUrl);
    // Headers from fetch()'s own Response are read-only (undici throws "immutable" on
    // .set()) — a fresh Headers copy is the only way to override Content-Type below.
    let upstreamHeaders = result.headers;
    if (contentType.startsWith('text/html')) {
      const charsetLabel = detectCharset(result.headers.get('content-type'), body);
      if (charsetLabel === null || charsetLabel === 'utf-8' || charsetLabel === 'utf8') {
        // No declared charset at all defaults to "assume UTF-8" (the modern default,
        // and this proxy's own longstanding behavior), same as an explicit utf-8 label.
        body = await rewriteHtmlBuffer(body, allowlist, currentPageUrl);
      } else {
        const decoded = decodeToUtf8(body, charsetLabel);
        if (decoded === null) {
          // An unrecognized label — running a UTF-8-only HTML parser over bytes that
          // were never declared (and can't now be proven) to be UTF-8 could corrupt the
          // page worse than leaving it alone, so this skips rewriting entirely and
          // serves the original bytes untouched, including the original content-type.
        } else {
          body = await rewriteHtmlBuffer(decoded, allowlist, currentPageUrl);
          upstreamHeaders = new Headers(result.headers);
          upstreamHeaders.set('content-type', withCharset(result.headers.get('content-type') ?? 'text/html', 'utf-8'));
        }
      }
    } else if (contentType.startsWith('text/css')) {
      body = Buffer.from(rewriteCss(body.toString('utf8'), { allowlist, currentPageUrl, primaryHost: allowlist.baseHost }), 'utf8');
    }

    const responseHeaders = buildProxyResponseHeaders(upstreamHeaders, webOrigin());
    response.status(result.status);
    for (const [name, value] of responseHeaders.entries()) {
      response.setHeader(name, value);
    }
    if (request.method === 'HEAD') {
      response.end();
    } else {
      response.send(body);
    }

    if (request.method === 'GET') {
      await deps.cache.set(slugHash, path, rawQuery, result.status, headersToObject(responseHeaders), body);
    }
  };
}

function sendFetchError(response: Response, error: unknown): void {
  if (error instanceof ResponseTooLargeError) {
    response.status(413).json({ code: 'PREVIEW_RESOURCE_TOO_LARGE', message: error.message });
    return;
  }
  if (error instanceof ProxyFetchError) {
    const status = error.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 502;
    response.status(status).json({ code: `PROXY_${error.code}`, message: error.message });
    return;
  }
  response.status(502).json({ code: 'PROXY_UNKNOWN_ERROR', message: 'Unexpected proxy error' });
}
