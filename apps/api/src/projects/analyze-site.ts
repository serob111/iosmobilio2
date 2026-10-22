import * as cheerio from 'cheerio';
import type { SupportedIcon } from '@mobilio/config';
import { computeDominantColor, generateLetterAvatar, processIconImage } from './icon.js';

class AnalyzeSiteError extends Error {}

export type SiteTab = { title: string; icon: SupportedIcon; path: string };

export type SiteAnalysis = {
  name: string;
  color: string;
  iconBuffer: Buffer;
  tabs: SiteTab[];
  hostname: string;
  url: string;
};

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractName($: cheerio.CheerioAPI, fallback: string): string {
  const ogName = $('meta[property="og:site_name"]').attr('content');
  if (ogName?.trim()) return ogName.trim().slice(0, 50);
  const title = $('title').first().text();
  if (title?.trim()) return title.trim().slice(0, 50);
  return fallback.slice(0, 50);
}

function extractThemeColor($: cheerio.CheerioAPI): string | null {
  const content = $('meta[name="theme-color"]').attr('content')?.trim();
  if (content && /^#[0-9a-fA-F]{6}$/.test(content)) return content;
  return null;
}

function extractIconUrl($: cheerio.CheerioAPI, baseUrl: string): string | null {
  const appleTouch = $('link[rel="apple-touch-icon"]').attr('href');
  if (appleTouch) {
    const resolved = resolveUrl(appleTouch, baseUrl);
    if (resolved) return resolved;
  }

  const iconCandidates: { href: string; size: number }[] = [];
  $('link[rel~="icon"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const sizesAttr = $(el).attr('sizes') ?? '';
    const size = parseInt(sizesAttr.split('x')[0] ?? '0', 10) || 0;
    iconCandidates.push({ href, size });
  });
  const best = iconCandidates.sort((a, b) => b.size - a.size)[0];
  if (best) {
    const resolved = resolveUrl(best.href, baseUrl);
    if (resolved) return resolved;
  }

  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    const resolved = resolveUrl(ogImage, baseUrl);
    if (resolved) return resolved;
  }

  return null;
}

type NavLink = { title: string; path: string };

function extractNavLinks($: cheerio.CheerioAPI, baseUrl: string): NavLink[] {
  const base = new URL(baseUrl);
  const navScope = $('nav').first();
  const anchors = (navScope.length > 0 ? navScope : $('body')).find('a[href]');
  const seen = new Set<string>();
  const links: NavLink[] = [];

  anchors.each((_, el) => {
    if (links.length >= 8) return;
    const href = $(el).attr('href');
    const text = ($(el).attr('aria-label') ?? $(el).text()).replace(/\s+/g, ' ').trim();
    // Skip anchors whose label is implausibly long for a nav item (e.g. mega-menu cards
    // with a heading + description inside one <a> — not a usable tab title).
    if (!href || !text || text.length > 60) return;
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      return;
    }
    if (resolved.hostname !== base.hostname) return;

    const p = resolved.pathname + (resolved.search || '');
    if (seen.has(p)) return;
    seen.add(p);
    links.push({ title: text.slice(0, 24), path: p || '/' });
  });

  return links;
}

const ICON_KEYWORDS: Array<[RegExp, SupportedIcon]> = [
  [/главн|home|index/i, 'home'],
  [/контакт|contact/i, 'location'],
  [/катал|shop|магазин|продукт|product|store/i, 'cart'],
  [/о нас|about|услуг|service/i, 'info'],
];

function buildTabs(navLinks: NavLink[]): SiteTab[] {
  const base: NavLink[] = navLinks.length > 0 ? navLinks : [{ title: 'Главная', path: '/' }];
  const used = new Set<SupportedIcon>();
  const fallbacks: SupportedIcon[] = ['grid', 'search', 'heart', 'chat', 'person'];
  let fallbackIndex = 0;

  return base.slice(0, 4).map((link) => {
    const matched = ICON_KEYWORDS.find(([re]) => re.test(link.title))?.[1];
    let icon: SupportedIcon;
    if (matched && !used.has(matched)) {
      icon = matched;
    } else {
      icon = fallbacks[fallbackIndex % fallbacks.length]!;
      fallbackIndex += 1;
    }
    used.add(icon);
    return { title: link.title, icon, path: link.path };
  });
}

async function downloadBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const DEFAULT_COLOR = '#2563EB';

export async function analyzeSite(rawUrl: string): Promise<SiteAnalysis> {
  const url = normalizeUrl(rawUrl);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AnalyzeSiteError('Введите корректный адрес сайта');
  }

  let html: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'follow' });
    if (!res.ok) throw new AnalyzeSiteError(`Сайт ответил с ошибкой ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) {
      throw new AnalyzeSiteError('Адрес не похож на обычную веб-страницу');
    }
    html = await res.text();
  } catch (error) {
    if (error instanceof AnalyzeSiteError) throw error;
    throw new AnalyzeSiteError(
      'Не удалось загрузить сайт. Проверьте адрес и подключение к интернету.',
    );
  }

  const $ = cheerio.load(html);
  const name = extractName($, parsedUrl.hostname);
  const iconUrl = extractIconUrl($, url);
  const iconSourceBuffer = iconUrl ? await downloadBytes(iconUrl) : null;

  let color = extractThemeColor($);
  let iconBuffer: Buffer | null = null;

  if (iconSourceBuffer) {
    try {
      iconBuffer = await processIconImage(iconSourceBuffer);
      if (!color) color = await computeDominantColor(iconSourceBuffer);
    } catch {
      iconBuffer = null;
    }
  }

  if (!iconBuffer) {
    color = color ?? DEFAULT_COLOR;
    iconBuffer = await generateLetterAvatar(name.charAt(0) || '?', color);
  }

  const tabs = buildTabs(extractNavLinks($, url));

  return {
    name,
    color: color ?? DEFAULT_COLOR,
    iconBuffer,
    tabs,
    hostname: parsedUrl.hostname,
    url,
  };
}
