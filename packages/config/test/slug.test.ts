import { describe, expect, it } from 'vitest';
import { slugify, SUPPORTED_ICONS, deriveBundleId } from '../src';

describe('slugify', () => {
  it('lowercases and dashes a simple name', () => {
    expect(slugify('My Shop')).toBe('my-shop');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Münich')).toBe('cafe-munich');
  });

  it('falls back to "app" when nothing latin/numeric survives', () => {
    expect(slugify('магазин')).toBe('app');
  });

  it('collapses repeated separators and trims edges', () => {
    expect(slugify('  Hello---World!! ')).toBe('hello-world');
  });
});

describe('SUPPORTED_ICONS', () => {
  it('is a non-empty, deduplicated list', () => {
    expect(SUPPORTED_ICONS.length).toBeGreaterThan(0);
    expect(new Set(SUPPORTED_ICONS).size).toBe(SUPPORTED_ICONS.length);
  });
});

describe('deriveBundleId with slugify', () => {
  it('produces a schema-valid bundle id from an arbitrary name', () => {
    const slug = slugify('My Cool Shop');
    expect(deriveBundleId('am.mobilio.app', slug)).toBe('am.mobilio.app.mycoolshop');
  });
});
