import { readFileSync } from 'fs';
import path from 'path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/mocks/server.js';

const lookupMock = vi.hoisted(() => vi.fn());
// Full mock, not a passthrough — unlike projects.integration.spec.ts, this file has no
// live-infra dependency that needs real DNS, so faking every lookup as a public address
// is simplest. "test.local" (used throughout below) doesn't really resolve; safeFetch's
// own DNS step would otherwise reject it before MSW ever gets a chance to intercept.
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

const { analyzeSite, AnalyzeSiteError } = await import('./analyze-site.js');

// MSW's lifecycle is scoped to just this file (not apps/api's global vitest setup) —
// several other spec files in this app drive real HTTP calls against a live NestJS
// instance via supertest, and MSW's node interceptor patches the same http/fetch
// internals supertest uses. Keeping it file-local avoids any risk of those tests'
// requests being intercepted.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const FIXTURES_DIR = path.resolve(__dirname, '../../test/fixtures');
const ICON_BYTES = readFileSync(path.join(FIXTURES_DIR, 'icon-source.png'));
const BASE = 'http://test.local';

function html(fixture: string): string {
  return readFileSync(path.join(FIXTURES_DIR, fixture), 'utf8');
}

function serveHtml(pathname: string, fixture: string) {
  server.use(
    http.get(`${BASE}${pathname}`, () =>
      HttpResponse.text(html(fixture), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ),
  );
}

function serveIcon(pathname: string) {
  server.use(
    http.get(`${BASE}${pathname}`, () =>
      HttpResponse.arrayBuffer(
        ICON_BYTES.buffer.slice(
          ICON_BYTES.byteOffset,
          ICON_BYTES.byteOffset + ICON_BYTES.byteLength,
        ),
        {
          headers: { 'content-type': 'image/png' },
        },
      ),
    ),
  );
}

async function expectAnalyzeSiteError(url: string, code: string): Promise<void> {
  const error: unknown = await analyzeSite(url).catch((e) => e);
  expect(error).toBeInstanceOf(AnalyzeSiteError);
  expect((error as InstanceType<typeof AnalyzeSiteError>).code).toBe(code);
}

describe('analyzeSite', () => {
  it('uses the apple-touch-icon, theme-color, and nav links when present', async () => {
    serveHtml('/', 'apple-touch-icon.html');
    serveIcon('/icon-source.png');

    const result = await analyzeSite(BASE);

    expect(result.name).toBe('Кофейня Уют');
    expect(result.color).toBe('#8B5E3C');
    expect(result.iconBuffer.length).toBeGreaterThan(0);
    expect(result.tabs).toEqual([
      { title: 'Главная', icon: 'home', path: '/' },
      { title: 'Меню', icon: 'grid', path: '/menu' },
      { title: 'Контакты', icon: 'location', path: '/contacts' },
    ]);
  });

  it('picks the largest sized favicon when there is no apple-touch-icon', async () => {
    serveHtml('/', 'favicon-only.html');
    serveIcon('/icon-source.png');
    serveIcon('/small-favicon.png');

    const result = await analyzeSite(BASE);

    expect(result.name).toBe('Мастерская велосипедов');
    // No theme-color meta tag -> color falls back to the icon's computed dominant color.
    expect(result.color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('falls back to og:image for the icon and a single default tab when there is no nav', async () => {
    serveHtml('/', 'og-image-only.html');
    serveIcon('/icon-source.png');

    const result = await analyzeSite(BASE);

    expect(result.name).toBe('Юридическая консультация');
    expect(result.tabs).toEqual([{ title: 'Главная', icon: 'home', path: '/' }]);
  });

  it('generates a letter avatar when no icon is found, and filters cross-origin/anchor/mailto links', async () => {
    serveHtml('/', 'no-icon.html');

    const result = await analyzeSite(BASE);

    expect(result.name).toBe('Школа танцев Ритм');
    expect(result.color).toBe('#2563EB');
    expect(result.tabs).toEqual([
      { title: 'Главная', icon: 'home', path: '/' },
      { title: 'Расписание', icon: 'grid', path: '/schedule' },
    ]);
  });

  it('dedupes by path, skips implausibly long labels, and caps at 4 tabs', async () => {
    serveHtml('/', 'messy-nav.html');
    serveIcon('/icon-source.png');

    const result = await analyzeSite(BASE);

    expect(result.name).toBe('Мегамаркет Онлайн');
    expect(result.tabs).toHaveLength(4);
    expect(result.tabs.map((t) => t.path)).toEqual(['/', '/catalog/', '/contacts', '/about']);
    expect(result.tabs[0]).toEqual({ title: 'Главная', icon: 'home', path: '/' });
    expect(result.tabs[2]).toEqual({ title: 'Контакты', icon: 'location', path: '/contacts' });
    // No tab repeats an icon.
    expect(new Set(result.tabs.map((t) => t.icon)).size).toBe(4);
  });

  it('surfaces INVALID_URL for an invalid url', async () => {
    await expectAnalyzeSiteError('not a url at all://', 'INVALID_URL');
  });

  it('surfaces SITE_ERROR_STATUS on a non-2xx response', async () => {
    // Real servers' error pages are usually served as text/html too — explicit here so
    // this exercises the status check, not an incidental content-type mismatch.
    server.use(
      http.get(`${BASE}/`, () =>
        HttpResponse.text('nope', { status: 500, headers: { 'content-type': 'text/html' } }),
      ),
    );
    await expectAnalyzeSiteError(BASE, 'SITE_ERROR_STATUS');
  });

  it('surfaces NOT_HTML for a non-HTML response', async () => {
    server.use(
      http.get(`${BASE}/`, () =>
        HttpResponse.json({ not: 'html' }, { headers: { 'content-type': 'application/json' } }),
      ),
    );
    await expectAnalyzeSiteError(BASE, 'NOT_HTML');
  });

  it('surfaces SITE_UNREACHABLE when the fetch itself fails', async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    await expectAnalyzeSiteError(BASE, 'SITE_UNREACHABLE');
  });

  it('surfaces UNSAFE_URL for a url that resolves to a private address, without ever calling MSW', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expectAnalyzeSiteError('http://private.example/', 'UNSAFE_URL');
  });
});
