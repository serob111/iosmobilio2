import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockEnv = vi.hoisted(() => ({ isStandaloneNative: true }));
vi.mock('../src/lib/env', () => mockEnv);

const mockPushLog = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/debugLog', () => ({ pushLog: mockPushLog }));

type FakeFile = { exists: boolean; text: () => Promise<string> };
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
    text() {
      const file = fakeFiles.get(this.key);
      if (!file) throw new Error(`no fake file registered for ${this.key}`);
      return file.text();
    }
  },
}));

const CONFIG_KEY = 'fake-bundle-root/mobilio/config.json';

const VALID_CONFIG = {
  id: 'p1',
  name: 'Test Shop',
  slug: 'test-shop',
  bundleId: 'am.mobilio.t.p1',
  source: { type: 'url', url: 'https://example.com' },
  theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
  tabs: [{ title: 'Home', icon: 'home', path: '/' }],
  features: { offline: true, share: true, deepLinks: false, pullToRefresh: true, push: false },
  allowedDomains: ['example.com'],
  trial: true,
};

describe('loadProjectConfig / readBundledConfig', () => {
  beforeEach(() => {
    fakeFiles.clear();
    mockEnv.isStandaloneNative = true;
    mockPushLog.mockClear();
  });

  it('loads a valid bundled config.json', async () => {
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => JSON.stringify(VALID_CONFIG) });
    const { loadProjectConfig } = await import('../src/config/loadConfig');
    const result = await loadProjectConfig();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.config.id).toBe('p1');
      expect(result.config.name).toBe('Test Shop');
    }
  });

  it('reports "invalid" for a corrupted (unparseable) config.json', async () => {
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => '{not valid json' });
    const { loadProjectConfig } = await import('../src/config/loadConfig');
    const result = await loadProjectConfig();
    expect(result.status).toBe('invalid');
  });

  it('reports "invalid" for well-formed JSON that fails schema validation', async () => {
    fakeFiles.set(CONFIG_KEY, { exists: true, text: async () => JSON.stringify({ ...VALID_CONFIG, tabs: [] }) });
    const { loadProjectConfig } = await import('../src/config/loadConfig');
    const result = await loadProjectConfig();
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('reports "missing" when mobilio/config.json does not exist in the bundle', async () => {
    const { loadProjectConfig } = await import('../src/config/loadConfig');
    const result = await loadProjectConfig();
    expect(result.status).toBe('missing');
  });

  it('falls back to demoConfig outside a standalone native build (Expo Go / web), without touching the bundle at all', async () => {
    mockEnv.isStandaloneNative = false;
    const { loadProjectConfig } = await import('../src/config/loadConfig');
    const result = await loadProjectConfig();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.config.id).toBe('demo');
    }
  });
});
