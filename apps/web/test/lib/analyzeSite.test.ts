import { readFileSync } from 'fs';
import path from 'path';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { analyzeSite } from '../../lib/analyzeSite';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
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
      HttpResponse.arrayBuffer(ICON_BYTES.buffer.slice(ICON_BYTES.byteOffset, ICON_BYTES.byteOffset + ICON_BYTES.byteLength), {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  );
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

  it('surfaces a clear error for an invalid url', async () => {
    await expect(analyzeSite('not a url at all://')).rejects.toThrow('Введите корректный адрес сайта');
  });

  it('surfaces a clear error on a non-2xx response', async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.text('nope', { status: 500 })));
    await expect(analyzeSite(BASE)).rejects.toThrow('Сайт ответил с ошибкой 500');
  });

  it('surfaces a clear error for a non-HTML response', async () => {
    server.use(
      http.get(`${BASE}/`, () => HttpResponse.json({ not: 'html' }, { headers: { 'content-type': 'application/json' } })),
    );
    await expect(analyzeSite(BASE)).rejects.toThrow('Адрес не похож на обычную веб-страницу');
  });

  it('surfaces a friendly error when the fetch itself fails', async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    await expect(analyzeSite(BASE)).rejects.toThrow('Не удалось загрузить сайт');
  });
});
