import { describe, expect, it } from 'vitest';
import { deriveBundleId, parseProjectConfig, type ProjectConfigInput } from '../src';

const validConfig: ProjectConfigInput = {
  id: 'p_abc123',
  name: 'My Shop',
  slug: 'my-shop',
  bundleId: 'am.mobilio.trial.myshop',
  source: { type: 'url', url: 'https://example.com' },
  theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
  tabs: [
    { title: 'Главная', icon: 'home', path: '/' },
    { title: 'Каталог', icon: 'grid', path: '/catalog' },
    { title: 'Контакты', icon: 'location', native: 'contacts' },
  ],
  nativeScreens: {
    onboarding: { enabled: true, slides: [{ title: 'Привет', text: 'Добро пожаловать' }] },
    contacts: { phone: '', address: '', mapUrl: '' },
  },
  features: { offline: true, share: true, deepLinks: true, pullToRefresh: true },
  allowedDomains: ['example.com'],
  privacyPolicyUrl: 'https://example.com/privacy',
  trial: true,
};

describe('parseProjectConfig', () => {
  it('parses the spec example config', () => {
    const result = parseProjectConfig(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Shop');
      expect(result.data.tabs).toHaveLength(3);
    }
  });

  it('parses an html-source config', () => {
    const result = parseProjectConfig({
      ...validConfig,
      source: { type: 'html', entry: 'index.html' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed bundleId with a Russian message', () => {
    const result = parseProjectConfig({ ...validConfig, bundleId: 'not a bundle id!' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes('bundleId'))).toBe(true);
    }
  });

  it('rejects zero tabs', () => {
    const result = parseProjectConfig({ ...validConfig, tabs: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 5 tabs', () => {
    const tabs = Array.from({ length: 6 }, (_, i) => ({
      title: `Tab ${i}`,
      icon: 'home',
      path: `/${i}`,
    }));
    const result = parseProjectConfig({ ...validConfig, tabs });
    expect(result.success).toBe(false);
  });

  it('rejects a tab with both path and native', () => {
    const result = parseProjectConfig({
      ...validConfig,
      tabs: [{ title: 'X', icon: 'home', path: '/', native: 'contacts' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tab with neither path nor native', () => {
    const result = parseProjectConfig({
      ...validConfig,
      tabs: [{ title: 'X', icon: 'home' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid hex color', () => {
    const result = parseProjectConfig({
      ...validConfig,
      theme: { ...validConfig.theme, primary: 'blue' },
    });
    expect(result.success).toBe(false);
  });
});

describe('deriveBundleId', () => {
  it('strips dashes from the slug', () => {
    expect(deriveBundleId('am.mobilio.trial', 'my-shop')).toBe('am.mobilio.trial.myshop');
  });
});
