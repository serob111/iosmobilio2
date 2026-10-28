import { All, Controller, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { Public } from '../../auth/public.decorator.js';
import { getClientRateLimitKey } from '../../common/rate-limit-key.js';
import { PreviewLinkService } from '../preview-link.service.js';
import { ProxyRateLimitService } from './proxy-rate-limit.js';
import { ProxyCacheService } from './proxy-cache.js';
import { deriveHostAllowlist, isHostAllowed, type HostAllowlist } from './host-allowlist.js';
import { proxyFetch, ProxyFetchError } from './proxy-fetch.js';
import { ResponseTooLargeError } from './response-size-limit.js';
import { buildProxyResponseHeaders } from './header-filter.js';
import { createHtmlRewriteStream } from './html-rewriter.js';
import { rewriteCss } from './css-rewriter.js';
import { renderExternalLinkPage } from './external-link-page.js';
import { HOST_OVERRIDE_QUERY_KEY } from './rewrite-url.js';

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

async function rewriteHtmlBuffer(buffer: Buffer, slug: string, allowlist: HostAllowlist, currentPageUrl: URL): Promise<Buffer> {
  const source = Readable.from([buffer.toString('utf8')]);
  source.setEncoding('utf8');
  const rewriter = createHtmlRewriteStream({
    slug,
    allowlist,
    currentPageUrl,
    primaryHost: allowlist.baseHost,
    proxyOrigin: process.env.PREVIEW_PROXY_ORIGIN ?? '',
  });
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

/**
 * The preview proxy's single entry point. Mounted on PREVIEW_PROXY_ORIGIN only (the
 * host-routing split in create-app.ts 404s this controller's whole path prefix on any
 * other host, and 404s every *other* controller's routes on this one) — a deliberately
 * different registrable domain from WEB_ORIGIN so the real site's cookies/framing never
 * mix with the main app's own session.
 *
 * Every response is fully buffered (bounded by MAX_BODY_BYTES, enforced progressively by
 * proxyFetch's own size-limit stream — never buffered-then-checked) before being sent:
 * HTML/CSS need their full body in hand to rewrite anyway, and buffering the rest keeps
 * one code path for "maybe rewrite, maybe cache, then send" instead of a separate
 * true-streaming path that would still need to special-case HTML/CSS.
 */
@Controller('s/:slug')
@Public()
export class ProxyController {
  constructor(
    private readonly previewLinkService: PreviewLinkService,
    private readonly rateLimit: ProxyRateLimitService,
    private readonly cache: ProxyCacheService,
  ) {}

  // Two separate registrations, not one `['', '*path']` array: Express 5/path-to-regexp
  // v8 only matches a bare `/s/:slug` (with or without a trailing slash) against the
  // path-less pattern — `/s/:slug/*path` requires at least one path segment after the
  // slash and does NOT also match the bare form, verified empirically against this repo's
  // actual express/path-to-regexp versions before writing this.
  @All()
  async handleRoot(
    @Req() request: Request,
    @Res() response: Response,
    @Param('slug') slug: string,
    @Query(HOST_OVERRIDE_QUERY_KEY) hostOverrideRaw: string | undefined,
  ): Promise<void> {
    return this.handle(request, response, slug, undefined, hostOverrideRaw);
  }

  @All('*path')
  async handleWithPath(
    @Req() request: Request,
    @Res() response: Response,
    @Param('slug') slug: string,
    @Param('path') pathSegments: string[],
    @Query(HOST_OVERRIDE_QUERY_KEY) hostOverrideRaw: string | undefined,
  ): Promise<void> {
    return this.handle(request, response, slug, pathSegments, hostOverrideRaw);
  }

  private async handle(
    request: Request,
    response: Response,
    slug: string,
    pathSegments: string[] | undefined,
    hostOverrideRaw: string | undefined,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.status(405).end();
      return;
    }

    const rateLimitKey = getClientRateLimitKey(request);
    const allowed = await this.rateLimit.checkAndIncrement(slug, rateLimitKey);
    if (!allowed) {
      response.status(429).send('Слишком много запросов. Попробуйте позже.');
      return;
    }

    const source = await this.previewLinkService.resolveProxySource(slug);
    if (!source) {
      response.status(404).json({ code: 'PREVIEW_NOT_FOUND', message: 'Preview not found' });
      return;
    }
    const allowlist = deriveHostAllowlist(source.sourceUrl);
    if (!allowlist) {
      response.status(502).json({ code: 'PREVIEW_SOURCE_INVALID', message: 'Preview source is misconfigured' });
      return;
    }

    const path = `/${(pathSegments ?? []).join('/')}`;
    const incomingUrl = new URL(request.url, 'http://placeholder.invalid');
    const rawQuery = incomingUrl.search;

    if (request.method === 'GET') {
      const cached = await this.cache.get(slug, path, rawQuery);
      if (cached) {
        response.status(cached.status);
        for (const [name, value] of Object.entries(cached.headers)) {
          response.setHeader(name, value);
        }
        response.send(Buffer.from(cached.bodyBase64, 'base64'));
        return;
      }
    }

    const scheme = new URL(source.sourceUrl).protocol;
    const targetHost =
      hostOverrideRaw && isHostAllowed(hostOverrideRaw, allowlist) ? hostOverrideRaw.toLowerCase() : allowlist.baseHost;
    const upstreamQuery = new URLSearchParams(incomingUrl.search);
    upstreamQuery.delete(HOST_OVERRIDE_QUERY_KEY);
    const upstreamQueryString = upstreamQuery.toString();
    const targetUrl = `${scheme}//${targetHost}${path}${upstreamQueryString ? `?${upstreamQueryString}` : ''}`;

    let outcome;
    try {
      outcome = await proxyFetch(targetUrl, {
        method: request.method as 'GET' | 'HEAD',
        allowlist,
        maxBodyBytes: MAX_BODY_BYTES,
        timeoutMs: TIMEOUT_MS,
        allowedContentTypePrefixes: ALLOWED_CONTENT_TYPE_PREFIXES,
      });
    } catch (error) {
      this.sendFetchError(response, error);
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
      this.sendFetchError(response, error);
      return;
    }

    const contentType = (result.headers.get('content-type') ?? '').toLowerCase();
    const currentPageUrl = new URL(result.finalUrl);
    if (contentType.startsWith('text/html')) {
      body = await rewriteHtmlBuffer(body, slug, allowlist, currentPageUrl);
    } else if (contentType.startsWith('text/css')) {
      body = Buffer.from(
        rewriteCss(body.toString('utf8'), { slug, allowlist, currentPageUrl, primaryHost: allowlist.baseHost }),
        'utf8',
      );
    }

    const responseHeaders = buildProxyResponseHeaders(result.headers, webOrigin());
    responseHeaders.delete('content-length');
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
      await this.cache.set(slug, path, rawQuery, result.status, headersToObject(responseHeaders), body);
    }
  }

  private sendFetchError(response: Response, error: unknown): void {
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
}
