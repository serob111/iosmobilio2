import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { Redis } from 'ioredis';
import { server } from '../../../test/mocks/server.js';
import { createApp } from '../../create-app.js';

// A different registrable domain from WEB_ORIGIN's default (http://localhost:3000) —
// validatePreviewEnv (src/preview/validate-preview-env.ts) refuses to start otherwise.
// ".invalid" is RFC 2606 reserved and never a real, resolvable hostname.
process.env.PREVIEW_PROXY_DOMAIN = 'proxy-itest.invalid';
const PROXY_DOMAIN = process.env.PREVIEW_PROXY_DOMAIN;

const FAKE_SITE_HOST = 'proxy-itest.example';
const CDN_HOST = 'cdn.proxy-itest.example';
const PRIVATE_SUBDOMAIN_HOST = 'private.proxy-itest.example';
const FOREIGN_HOST = 'foreign-itest.example';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  const publicAddress = [{ address: '93.184.216.34', family: 4 }];
  const privateAddress = [{ address: '10.1.2.3', family: 4 }];
  return {
    ...actual,
    lookup: ((hostname: string, options: unknown) => {
      if (hostname === FAKE_SITE_HOST || hostname === CDN_HOST) return Promise.resolve(publicAddress);
      if (hostname === PRIVATE_SUBDOMAIN_HOST) return Promise.resolve(privateAddress);
      return actual.lookup(hostname, options as never);
    }) as typeof actual.lookup,
  };
});

const hasLiveServices =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.MIGRATOR_DATABASE_URL) &&
  Boolean(process.env.REDIS_URL) &&
  Boolean(process.env.BETTER_AUTH_SECRET) &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_BUCKET) &&
  Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error(
    'REQUIRE_LIVE_SERVICES=true but DATABASE_URL/MIGRATOR_DATABASE_URL/REDIS_URL/BETTER_AUTH_SECRET/' +
      'S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not all set',
  );
}

describe.skipIf(!hasLiveServices)('preview proxy (<slug>.<PREVIEW_PROXY_DOMAIN>/*) — live Postgres + Redis + MinIO', () => {
  let app: INestApplication;
  let mailLogFile: string;
  let redis: Redis;

  beforeAll(async () => {
    mailLogFile = join(tmpdir(), `mobilio-mail-log-proxy-${Date.now()}.ndjson`);
    process.env.MAIL_LOG_FILE = mailLogFile;
    process.env.BUILD_RUNNER = 'fake';

    app = await createApp();
    await app.init();

    redis = new Redis(process.env.REDIS_URL!);
    server.listen({ onUnhandledFrame: 'bypass' });
  });

  afterAll(async () => {
    server.close();
    await app.close();
    await redis.quit();
    if (existsSync(mailLogFile)) {
      unlinkSync(mailLogFile);
    }
    delete process.env.MAIL_LOG_FILE;
    delete process.env.BUILD_RUNNER;
  });

  async function resetRateLimitBuckets(): Promise<void> {
    const keys = await redis.keys('*|/sign-in/magic-link');
    keys.push(...(await redis.keys('*|/magic-link/verify')));
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  beforeEach(async () => {
    await resetRateLimitBuckets();
  });

  afterEach(() => server.resetHandlers());

  function mockHomepage(): void {
    server.use(
      http.get(`https://${FAKE_SITE_HOST}/`, () =>
        new HttpResponse(
          `<html><head><title>Proxy Test Cafe</title></head>
           <body>
             <nav><a href="/menu">Menu</a></nav>
             <a href="https://${CDN_HOST}/logo.png">Logo</a>
             <a href="https://${FOREIGN_HOST}/other">External</a>
           </body></html>`,
          {
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'set-cookie': 'realsite_session=abc123; Path=/',
              'x-frame-options': 'DENY',
              'content-security-policy': "default-src 'self'",
              'strict-transport-security': 'max-age=63072000',
              'clear-site-data': '"cache"',
            },
          },
        ),
      ),
    );
  }

  async function createProjectForFakeSite(cookie: string[]): Promise<{ orgId: string; projectId: string }> {
    const me = await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
    const orgId = me.body.organizations[0].id as string;
    const createRes = await request(app.getHttpServer())
      .post(`/orgs/${orgId}/projects`)
      .set('Cookie', cookie)
      .send({ url: `https://${FAKE_SITE_HOST}/` })
      .expect(201);
    return { orgId, projectId: createRes.body.id as string };
  }

  async function signInByMagicLink(email: string): Promise<string[]> {
    const { readFileSync } = await import('node:fs');
    const signInRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/magic-link')
      .set('Origin', 'http://localhost:3000')
      .send({ email, callbackURL: 'http://localhost:3000/' });
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
    if (!cookie) throw new Error('No session cookie set by magic-link verify');
    return Array.isArray(cookie) ? cookie : [cookie];
  }

  async function createPreviewSlug(cookie: string[]): Promise<string> {
    mockHomepage();
    const { orgId, projectId } = await createProjectForFakeSite(cookie);
    const linkRes = await request(app.getHttpServer())
      .post(`/orgs/${orgId}/projects/${projectId}/preview-link`)
      .set('Cookie', cookie)
      .expect(201);
    return (linkRes.body.url as string).split('/preview/')[1]!;
  }

  function proxyGet(slug: string, path: string): request.Test {
    return request(app.getHttpServer())
      .get(path)
      .set('Host', `${slug}.${PROXY_DOMAIN}`);
  }

  it('strips Set-Cookie/X-Frame-Options/CSP/HSTS/Clear-Site-Data and sets its own security headers', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-headers-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);

    const res = await proxyGet(slug, '/').expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['clear-site-data']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBe('frame-ancestors http://localhost:3000');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('rewrites an allowed-subdomain link into a bare path, leaves a foreign-host link untouched, injects no <base>, and injects the banner', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-rewrite-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);

    const res = await proxyGet(slug, '/').expect(200);
    expect(res.text).toContain(`href="/logo.png?__mobilio_host=${CDN_HOST}"`);
    expect(res.text).toContain(`href="https://${FOREIGN_HOST}/other"`);
    expect(res.text).not.toContain('<base');
    expect(res.text).toContain('Preview · Mobilio');
    expect(res.text).toContain('window.open');
  });

  it('returns 405 for a non-GET/HEAD method', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-405-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    await request(app.getHttpServer()).post('/').set('Host', `${slug}.${PROXY_DOMAIN}`).expect(405);
  });

  it('does not follow a redirect to a host outside the allowlist — renders an external-link page instead', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-redirect-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    server.use(http.get(`https://${FAKE_SITE_HOST}/go`, () => HttpResponse.redirect(`https://${FOREIGN_HOST}/landing`, 302)));

    const res = await proxyGet(slug, '/go').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(`href="https://${FOREIGN_HOST}/landing"`);
    expect(res.text).toContain('target="_blank"');
  });

  it('rejects a response whose content-type is not in the allowed list (415)', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-415-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    server.use(
      http.get(`https://${FAKE_SITE_HOST}/archive.zip`, () =>
        new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/zip' } }),
      ),
    );

    await proxyGet(slug, '/archive.zip').expect(415);
  });

  it('cuts off a response exceeding the 10MB body cap (413)', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-413-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1024).fill(1);
    server.use(
      http.get(`https://${FAKE_SITE_HOST}/big.png`, () => new HttpResponse(oversized, { headers: { 'content-type': 'image/png' } })),
    );

    await proxyGet(slug, '/big.png').expect(413);
  }, 20_000);

  it('rejects an allowed-subdomain host that resolves to a private address (defense in depth)', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-ssrf-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);

    await proxyGet(slug, `/?__mobilio_host=${PRIVATE_SUBDOMAIN_HOST}`).expect(502);
  });

  it('caches a 200 response for repeat requests to the same slug+path+query', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-cache-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    let hits = 0;
    server.use(
      http.get(`https://${FAKE_SITE_HOST}/counter`, () => {
        hits += 1;
        return HttpResponse.text(`<html><body>hits=${hits}</body></html>`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }),
    );

    const first = await proxyGet(slug, '/counter').expect(200);
    expect(first.text).toContain('hits=1');
    const second = await proxyGet(slug, '/counter').expect(200);
    expect(second.text).toContain('hits=1');
    expect(hits).toBe(1);
  });

  it('does not answer a preview-shaped path on the main (non-proxy) host', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-hostsplit-main-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    // No .set('Host', ...) — supertest's default Host for a request to
    // app.getHttpServer() is the loopback address it's actually bound to, never a
    // *.PROXY_DOMAIN subdomain, so this exercises "main host" exactly as a real
    // deployment would — the middleware calls next(), and Nest's own router finds no
    // controller matching an arbitrary path like this.
    await request(app.getHttpServer()).get(`/${slug}-shaped-path`).expect(404);
  });

  it('does not answer ordinary API routes on a valid-looking preview subdomain', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-hostsplit-health-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    server.use(
      http.get(`https://${FAKE_SITE_HOST}/health`, () =>
        HttpResponse.text('<html><body>not the real api health check</body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    // A real, existing api route path (/health) — must still be served as this slug's
    // own proxied content (the mocked fake-site response above), never the real
    // HealthController's JSON, proving the proxy middleware intercepts it first.
    const res = await proxyGet(slug, '/health').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('not the real api health check');
  });

  it('404s on the bare proxy domain with no slug subdomain at all', async () => {
    await request(app.getHttpServer()).get('/').set('Host', PROXY_DOMAIN).expect(404);
  });

  it('404s for a forged Host containing an embedded dot (not a single valid label)', async () => {
    await request(app.getHttpServer()).get('/').set('Host', `evil.com.${PROXY_DOMAIN}`).expect(404);
  });

  it('404s for an IDN/punycode subdomain label', async () => {
    await request(app.getHttpServer()).get('/').set('Host', `xn--r8jz45g.${PROXY_DOMAIN}`).expect(404);
  });

  it('404s for a slug of the wrong length', async () => {
    await request(app.getHttpServer()).get('/').set('Host', `tooshort.${PROXY_DOMAIN}`).expect(404);
  });

  it('404s for a nested subdomain (a.<slug>.domain)', async () => {
    const cookie = await signInByMagicLink(`itest-proxy-nested-${Date.now()}@example.com`);
    const slug = await createPreviewSlug(cookie);
    await request(app.getHttpServer()).get('/').set('Host', `a.${slug}.${PROXY_DOMAIN}`).expect(404);
  });
});
