import { describe, expect, it, vi, beforeEach } from 'vitest';

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

describe('readBrandSplashData', () => {
  beforeEach(() => {
    fakeFiles.clear();
    mockEnv.isStandaloneNative = true;
  });

  it('reads the background color and splash image uri from mobilio/config.json', async () => {
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => JSON.stringify({ theme: { background: '#FF0000' } }) });
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

  it('defaults to white when config.json has no theme.background', async () => {
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
