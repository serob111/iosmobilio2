import { json, urlencoded } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { validateBuildEnv } from './builds/validate-build-env.js';
import { validatePreviewEnv } from './preview/validate-preview-env.js';
import { validateSafeFetchTestEnv } from './net/safe-fetch.js';
import { createPreviewProxyMiddleware } from './preview/proxy/proxy-middleware.js';
import { PreviewLinkService } from './preview/preview-link.service.js';
import { ProxyRateLimitService } from './preview/proxy/proxy-rate-limit.js';
import { ProxyCacheService } from './preview/proxy/proxy-cache.js';

/**
 * Builds the fully-wired app (not just `new NestFactory` — the Better Auth mount,
 * global filter/CORS) without calling `.listen()`, so main.ts and integration tests
 * exercise exactly the same bootstrap path rather than a test-only approximation of it.
 */
export async function createApp(): Promise<INestApplication> {
  // Fails fast, before Nest even starts wiring modules, rather than booting
  // successfully and only discovering a missing GITHUB_*/BUILD_TOKEN_KEY secret on the
  // first real build request.
  validateBuildEnv();
  validatePreviewEnv();
  validateSafeFetchTestEnv();

  // Better Auth needs the raw, unparsed request body (it parses JSON itself from the
  // Fetch API Request it builds) — bodyParser:false + mounting its handler before
  // Nest's own json()/urlencoded() middleware is the documented way to let both coexist.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new HttpExceptionFilter());
  // apps/web calls this api directly from the browser (not through Next's server), so
  // the session cookie Better Auth sets on this origin round-trips correctly —
  // credentials:true is required for that, and so is a specific (non-wildcard) origin.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });

  // How many reverse-proxy hops to trust X-Forwarded-For through before trusting it as
  // request.ip — 0 (default) means trust nothing, so a client can't spoof its own IP by
  // sending an arbitrary X-Forwarded-For header and dodge the drafts rate limit. Prod
  // behind Caddy: TRUST_PROXY_HOPS=1 (see .env.example/README).
  app.getHttpAdapter().getInstance().set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));

  // Every preview answers on its own origin, `https://<slug>.<PREVIEW_PROXY_DOMAIN>` — this
  // one middleware both decides whether a request is "proxy territory" at all (by Host
  // header, see preview-host.ts) and, if so, handles it completely, mounted ahead of
  // every other route so a Host-header-spoofed request can never reach an authenticated
  // api route and vice versa. See proxy-middleware.ts's own comment for why this has to
  // be a plain Express middleware rather than a Nest controller.
  app.use(
    createPreviewProxyMiddleware({
      previewLinkService: app.get(PreviewLinkService),
      rateLimit: app.get(ProxyRateLimitService),
      cache: app.get(ProxyCacheService),
    }),
  );

  const authService = app.get(AuthService);
  app.use('/api/auth', toNodeHandler(authService.auth));
  app.use(json());
  app.use(urlencoded({ extended: true }));

  return app;
}
