import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@mobilio/config';

// storage.ts reads process.env.DATA_DIR once, at module load time — static imports are
// hoisted in ESM regardless of source order, so the env var must be set before a *dynamic*
// import, not before a static one.
let storage: typeof import('../../lib/storage');
let tempDir: string;

const sampleConfig: ProjectConfig = {
  id: 'p_test123456',
  name: 'Test App',
  slug: 'test-app',
  bundleId: 'am.mobilio.app.testapp',
  source: { type: 'url', url: 'https://example.com' },
  theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
  tabs: [{ title: 'Главная', icon: 'home', path: '/' }],
  features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
  allowedDomains: ['example.com'],
  trial: true,
};

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mobilio-storage-test-'));
  process.env.DATA_DIR = tempDir;
  storage = await import('../../lib/storage');
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

describe('createProjectId', () => {
  it('produces a p_<hex> id matching the storage id pattern', () => {
    const id = storage.createProjectId();
    expect(id).toMatch(/^p_[a-f0-9]{12}$/);
  });

  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => storage.createProjectId()));
    expect(ids.size).toBe(20);
  });
});

describe('invalid ids are rejected (path traversal protection)', () => {
  it.each([
    '../../etc/passwd',
    'p_../../etc/passwd',
    'P_UPPERCASE',
    'px_wrongprefix',
    '',
    'p_',
    'p_has space',
    'p_has/slash',
  ])('rejects %j', async (badId) => {
    await expect(storage.readConfig(badId)).rejects.toThrow('Некорректный идентификатор проекта');
  });
});

describe('config read/write round-trip', () => {
  const id = 'p_configtest1';

  it('round-trips a config', async () => {
    await storage.writeConfig(id, sampleConfig);
    const read = await storage.readConfig(id);
    expect(read).toEqual(sampleConfig);
  });

  it('projectExists reflects whether a config was written', async () => {
    expect(await storage.projectExists(id)).toBe(true);
    expect(await storage.projectExists('p_doesnotexist')).toBe(false);
  });
});

describe('icon read/write round-trip', () => {
  const id = 'p_icontest1';
  const bytes = Buffer.from([137, 80, 78, 71]); // PNG magic bytes, doesn't need to be a full valid image for this round-trip

  it('round-trips icon bytes', async () => {
    await storage.writeIcon(id, bytes);
    const read = await storage.readIcon(id);
    expect(read.equals(bytes)).toBe(true);
  });
});

describe('build status read/write round-trip', () => {
  const id = 'p_buildtest1';

  it('returns null before anything is written', async () => {
    expect(await storage.readBuildStatus('p_neverbuilt')).toBeNull();
  });

  it('round-trips a build status', async () => {
    const status: import('../../lib/storage').BuildStatus = { status: 'queued', dispatchedAt: 123 };
    await storage.writeBuildStatus(id, status);
    expect(await storage.readBuildStatus(id)).toEqual(status);
  });
});

describe('ipa read/write round-trip', () => {
  const id = 'p_ipatest1';
  const bytes = Buffer.from('fake ipa contents');

  it('hasIpa is false before any .ipa is written', async () => {
    expect(await storage.hasIpa('p_neveripad')).toBe(false);
  });

  it('round-trips ipa bytes and reports hasIpa afterwards', async () => {
    await storage.writeIpa(id, bytes);
    expect(await storage.hasIpa(id)).toBe(true);
    const read = await storage.readIpa(id);
    expect(read.equals(bytes)).toBe(true);
  });

  it('ipaPath stays within the configured data directory', () => {
    expect(storage.ipaPath(id)).toContain(tempDir);
  });
});
