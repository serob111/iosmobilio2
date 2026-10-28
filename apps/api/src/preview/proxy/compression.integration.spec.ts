import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { chromium, type Browser } from 'playwright';
import { runInTenantContext, getTenantDb, schema } from '@mobilio/db';
import { createApp } from '../../create-app.js';
import { DbService } from '../../db/db.service.js';
import { generatePreviewSlug } from '../preview-slug.js';

// A fixed port, not an ephemeral one from app.listen(0) — the (still-current, pre-item-2)
// HTML rewriter bakes PREVIEW_PROXY_ORIGIN verbatim into a <base href>, and the browser
// resolves every absolute-*path* reference on the page against that base's authority
// (scheme+host+port), not the page's own actual origin. An ephemeral port is only known
// *after* the server starts listening, but PREVIEW_PROXY_ORIGIN must already be set
// *before* createApp() runs (validatePreviewEnv reads it at startup) — so this fixes the
// api's own listen port to match, rather than discovering one after the fact.
const API_PORT = 34567;
process.env.PREVIEW_PROXY_ORIGIN = `http://localhost:${API_PORT}`;
process.env.WEB_ORIGIN = 'http://127.0.0.1:9999';
// Lets proxyFetch actually reach the real local upstream server this test spins up —
// see net/safe-fetch.ts's safeFetchTestOverrides for why this is scoped to 127.0.0.1/::1
// only, and refused outright if NODE_ENV=production.
process.env.SAFE_FETCH_ALLOW_LOCAL_FOR_TESTING = 'true';

const hasLiveServices =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.REDIS_URL) &&
  Boolean(process.env.BETTER_AUTH_SECRET) &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_BUCKET) &&
  Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error(
    'REQUIRE_LIVE_SERVICES=true but DATABASE_URL/REDIS_URL/BETTER_AUTH_SECRET/S3_ENDPOINT/S3_BUCKET/' +
      'S3_ACCESS_KEY_ID are not all set',
  );
}

type Encoding = 'gzip' | 'br' | 'deflate';
const ENCODINGS: Encoding[] = ['gzip', 'br', 'deflate'];

function compress(encoding: Encoding, data: Buffer): Buffer {
  if (encoding === 'gzip') return gzipSync(data);
  if (encoding === 'br') return brotliCompressSync(data);
  return deflateSync(data);
}

/**
 * A REAL local HTTP server (not MSW — MSW mocks the fetch call itself, so nothing is
 * ever actually compressed; this needs a real gzip/br/deflate round trip through a real
 * undici `fetch()` to prove the Content-Encoding/Content-Length fix in header-filter.ts
 * actually works end to end). Serves, per encoding, an HTML page whose <link>/<script>
 * point at that same encoding's CSS/JS — each genuinely compressed with that algorithm.
 */
function startUpstream(upstreamPort: () => number): Server {
  function pageHtml(encoding: Encoding): string {
    const port = upstreamPort();
    return (
      `<!doctype html><html><head>` +
      `<link rel="stylesheet" href="http://127.0.0.1:${port}/${encoding}/style.css">` +
      `</head><body><p id="marker">unset</p>` +
      `<script src="http://127.0.0.1:${port}/${encoding}/script.js"></script>` +
      `</body></html>`
    );
  }
  const cssFor = (encoding: Encoding) => `#marker { color: rgb(1, 2, 3); }`.replace('ENC', encoding);
  const jsFor = (encoding: Encoding) => `document.getElementById('marker').textContent = 'ok-${encoding}';`;

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://upstream.invalid');
    const match = /^\/(gzip|br|deflate)\/(page\.html|style\.css|script\.js)$/.exec(url.pathname);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const encoding = match[1] as Encoding;
    const file = match[2];
    const [body, contentType] =
      file === 'page.html'
        ? [pageHtml(encoding), 'text/html; charset=utf-8']
        : file === 'style.css'
          ? [cssFor(encoding), 'text/css; charset=utf-8']
          : [jsFor(encoding), 'application/javascript; charset=utf-8'];
    const compressed = compress(encoding, Buffer.from(body, 'utf8'));
    res.writeHead(200, {
      'content-type': contentType,
      'content-encoding': encoding,
      'content-length': compressed.length,
    });
    res.end(compressed);
  });
}

describe.skipIf(!hasLiveServices)(
  'preview proxy: Content-Encoding / hop-by-hop header stripping (live Postgres + Redis + MinIO + real browser)',
  () => {
    let app: INestApplication;
    let upstream: Server;
    let upstreamPort: number;
    let browser: Browser;
    let mailLogFile: string;

    beforeAll(async () => {
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      mailLogFile = join(tmpdir(), `mobilio-mail-log-compression-${Date.now()}.ndjson`);
      process.env.MAIL_LOG_FILE = mailLogFile;
      process.env.BUILD_RUNNER = 'fake';

      app = await createApp();
      await app.init();
      await app.listen(API_PORT, '127.0.0.1');

      upstream = startUpstream(() => upstreamPort);
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
      upstreamPort = (upstream.address() as AddressInfo).port;

      browser = await chromium.launch();
    }, 60_000);

    afterAll(async () => {
      await browser.close();
      await new Promise((resolve) => upstream.close(resolve));
      await app.close();
      delete process.env.MAIL_LOG_FILE;
      delete process.env.BUILD_RUNNER;
    });

    async function signInAndGetOrgId(): Promise<string> {
      const email = `itest-compression-${Date.now()}@example.com`;
      const signInRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/magic-link')
        .set('Origin', 'http://127.0.0.1:0')
        .send({ email, callbackURL: 'http://127.0.0.1:0/' });
      expect(signInRes.status).toBe(200);

      const lines = readFileSync(mailLogFile, 'utf8').trim().split('\n');
      const messages = lines.map((line) => JSON.parse(line) as { to: string; body: string });
      const match = [...messages].reverse().find((m) => m.to === email);
      if (!match) throw new Error(`No mail logged for ${email}`);
      const magicLinkUrl = match.body.match(/https?:\/\/\S+/)?.[0];
      if (!magicLinkUrl) throw new Error(`No URL in mail body for ${email}`);
      const verifyPath = magicLinkUrl.replace(/^https?:\/\/[^/]+/, '');

      const verifyRes = await request(app.getHttpServer()).get(verifyPath).expect(302);
      const cookie = verifyRes.headers['set-cookie'];
      const meRes = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
      return meRes.body.organizations[0].id as string;
    }

    it(
      'serves gzip/br/deflate-encoded HTML/CSS/JS correctly decompressed and rendered in a real browser',
      async () => {
        const orgId = await signInAndGetOrgId();
        const dbService = app.get(DbService);
        const { rawSlug, slugHash } = generatePreviewSlug();

        await runInTenantContext(dbService.db, { orgId, userId: 'compression-test' }, async () => {
          const tx = getTenantDb();
          const [project] = await tx
            .insert(schema.projects)
            .values({
              orgId,
              name: 'Compression Test',
              sourceUrl: `http://127.0.0.1:${upstreamPort}/`,
              config: {
                id: 'compression-test',
                name: 'Compression Test',
                slug: 'compression-test',
                bundleId: 'com.example.compressiontest',
                source: { type: 'url', url: `http://127.0.0.1:${upstreamPort}/` },
                theme: { primary: '#000000', background: '#ffffff', statusBar: 'dark' },
                tabs: [{ title: 'Home', icon: 'home', path: '/gzip/page.html' }],
                features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
                allowedDomains: [],
                trial: true,
              },
            })
            .returning();
          await tx.insert(schema.previewLinks).values({ orgId, projectId: project!.id, slugHash });
        });

        for (const encoding of ENCODINGS) {
          const page = await browser.newPage();
          await page.goto(`http://localhost:${API_PORT}/s/${rawSlug}/${encoding}/page.html`);
          await page.waitForFunction(() => document.getElementById('marker')?.textContent !== 'unset');
          const text = await page.textContent('#marker');
          expect(text).toBe(`ok-${encoding}`);
          const color = await page.$eval('#marker', (el) => getComputedStyle(el).color);
          expect(color).toBe('rgb(1, 2, 3)');
          await page.close();
        }
      },
      30_000,
    );
  },
);
