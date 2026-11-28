import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectStorage } from '@mobilio/storage';
import { getCachedBaseIpa } from '../src/base-ipa-cache';

function sha256Of(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function fakeStorage(content: string, { onGetStream }: { onGetStream?: () => void } = {}): ObjectStorage {
  return {
    put: vi.fn(),
    putStream: vi.fn(),
    get: vi.fn(),
    getStream: vi.fn(async () => {
      onGetStream?.();
      return Readable.from([Buffer.from(content)]);
    }),
    delete: vi.fn(),
    signedUrl: vi.fn(),
    copy: vi.fn(),
    list: vi.fn(),
  } as unknown as ObjectStorage;
}

describe('getCachedBaseIpa', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'repacker-base-ipa-cache-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('downloads and caches the base.ipa on a cold cache, returning a path with the right content', async () => {
    const content = 'fake base.ipa bytes';
    const sha256 = sha256Of(content);
    const storage = fakeStorage(content);

    const path = await getCachedBaseIpa(storage, 'shell-base/1.0.0/base.ipa', sha256, { cacheDir });

    expect(readFileSync(path, 'utf8')).toBe(content);
    expect(storage.getStream).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached file on a second call, without downloading again', async () => {
    const content = 'fake base.ipa bytes';
    const sha256 = sha256Of(content);
    const storage = fakeStorage(content);

    const firstPath = await getCachedBaseIpa(storage, 'shell-base/1.0.0/base.ipa', sha256, { cacheDir });
    const secondPath = await getCachedBaseIpa(storage, 'shell-base/1.0.0/base.ipa', sha256, { cacheDir });

    expect(secondPath).toBe(firstPath);
    expect(storage.getStream).toHaveBeenCalledTimes(1);
  });

  it('re-downloads when the cached file at that path has been corrupted', async () => {
    const content = 'fake base.ipa bytes';
    const sha256 = sha256Of(content);
    const storage = fakeStorage(content);

    const path = await getCachedBaseIpa(storage, 'shell-base/1.0.0/base.ipa', sha256, { cacheDir });
    writeFileSync(path, 'corrupted bytes, does not match sha256 anymore');

    const secondPath = await getCachedBaseIpa(storage, 'shell-base/1.0.0/base.ipa', sha256, { cacheDir });
    expect(readFileSync(secondPath, 'utf8')).toBe(content);
    expect(storage.getStream).toHaveBeenCalledTimes(2);
  });

  it('throws and cleans up the temp file when the freshly-downloaded content does not match the expected sha256', async () => {
    const content = 'actual downloaded content';
    const wrongSha256 = sha256Of('something else entirely');
    const storage = fakeStorage(content);

    await expect(getCachedBaseIpa(storage, 'shell-base/1.0.0/base.ipa', wrongSha256, { cacheDir })).rejects.toThrow(/sha256 mismatch/);

    const leftoverFiles = (await import('node:fs')).readdirSync(cacheDir);
    expect(leftoverFiles).toHaveLength(0);
  });

  it('creates the cache directory if it does not exist yet', async () => {
    const nestedDir = join(cacheDir, 'nested', 'cache', 'dir');
    const content = 'fake base.ipa bytes';
    const sha256 = sha256Of(content);
    const storage = fakeStorage(content);

    const path = await getCachedBaseIpa(storage, 'shell-base/1.0.0/base.ipa', sha256, { cacheDir: nestedDir });
    expect(existsSync(path)).toBe(true);
  });
});
