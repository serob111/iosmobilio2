import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProjectConfig } from '@mobilio/config';

const mockEnv = vi.hoisted(() => ({ isStandaloneNative: true }));
vi.mock('../src/lib/env', () => mockEnv);
vi.mock('../src/lib/debugLog', () => ({ pushLog: vi.fn() }));

type FakeFile = { exists: boolean; uri?: string; text?: () => Promise<string> };
const fakeFiles = vi.hoisted(() => new Map<string, FakeFile>());
vi.mock('expo-file-system', () => ({
  Paths: { bundle: 'fake-bundle-root' },
  File: class {
    key: string;
    constructor(...segments: unknown[]) {
      this.key = segments.join('/');
    }
    get exists() {
      return fakeFiles.get(this.key)?.exists ?? false;
    }
    get uri() {
      return fakeFiles.get(this.key)?.uri;
    }
    text() {
      const file = fakeFiles.get(this.key);
      if (!file?.text) throw new Error(`no fake text for ${this.key}`);
      return file.text();
    }
  },
}));

const CONFIG_KEY = 'fake-bundle-root/mobilio/config.json';
const SPLASH_KEY = 'fake-bundle-root/mobilio/splash.png';

function validConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'p1',
    name: 'Test',
    slug: 'test',
    bundleId: 'am.mobilio.t.p1',
    source: { type: 'url', url: 'https://example.com' },
    theme: { primary: '#2563EB', background: '#FF0000', statusBar: 'dark' },
    tabs: [{ title: 'Home', icon: 'home', path: '/' }],
    features: { offline: true, share: true, deepLinks: false, pullToRefresh: true, push: false },
    allowedDomains: [],
    trial: true,
    ...overrides,
  };
}

describe('readBrandSplashData', () => {
  beforeEach(() => {
    fakeFiles.clear();
    mockEnv.isStandaloneNative = true;
  });

  it('reads the background color and splash image uri from a validated mobilio/config.json', async () => {
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => JSON.stringify(validConfig()) });
    fakeFiles.set(SPLASH_KEY, { exists: true, uri: 'file:///fake/splash.png' });
    const { readBrandSplashData } = await import('../src/components/brandSplashData');
    const result = await readBrandSplashData();
    expect(result).toEqual({ backgroundColor: '#FF0000', imageUri: 'file:///fake/splash.png' });
  });

  it('defaults to white and no image when config.json is missing', async () => {
    const { readBrandSplashData } = await import('../src/components/brandSplashData');
    const result = await readBrandSplashData();
    expect(result).toEqual({ backgroundColor: '#FFFFFF' });
  });

  it('falls back to white with no image outside a standalone native build, without reading any file', async () => {
    mockEnv.isStandaloneNative = false;
    const { readBrandSplashData } = await import('../src/components/brandSplashData');
    const result = await readBrandSplashData();
    expect(result).toEqual({ backgroundColor: '#FFFFFF' });
  });

  it('defaults to white and warns when theme.background is not a valid hex color', async () => {
    const { pushLog } = await import('../src/lib/debugLog');
    const raw = JSON.parse(JSON.stringify(validConfig())) as Record<string, unknown>;
    (raw.theme as Record<string, unknown>).background = 'not-a-color';
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => JSON.stringify(raw) });
    const { readBrandSplashData } = await import('../src/components/brandSplashData');
    const result = await readBrandSplashData();
    expect(result.backgroundColor).toBe('#FFFFFF');
    expect(pushLog).toHaveBeenCalledWith('warn', 'splash', expect.any(String), expect.anything());
  });

  it('defaults to white when config.json fails schema validation entirely', async () => {
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => JSON.stringify({}) });
    const { readBrandSplashData } = await import('../src/components/brandSplashData');
    const result = await readBrandSplashData();
    expect(result.backgroundColor).toBe('#FFFFFF');
  });

  it('falls back to a safe default if config.json is corrupted', async () => {
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => '{not json' });
    const { readBrandSplashData } = await import('../src/components/brandSplashData');
    const result = await readBrandSplashData();
    expect(result).toEqual({ backgroundColor: '#FFFFFF' });
  });
});
