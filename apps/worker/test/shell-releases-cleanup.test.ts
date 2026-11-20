import { describe, expect, it, vi } from 'vitest';
import type { ObjectStorage } from '@mobilio/storage';
import { cleanupStaleShellReleaseUploads } from '../src/shell-releases-cleanup';

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeStorage(
  objects: Array<{ key: string; lastModified: Date }>,
  deleteImpl: (key: string) => Promise<void> = () => Promise.resolve(),
): ObjectStorage {
  return {
    list: vi.fn().mockResolvedValue(objects),
    delete: vi.fn(deleteImpl),
  } as unknown as ObjectStorage;
}

describe('cleanupStaleShellReleaseUploads', () => {
  it('deletes nothing and reports zero when there are no objects at all', async () => {
    const storage = fakeStorage([]);
    const result = await cleanupStaleShellReleaseUploads(storage);
    expect(result).toEqual({ deletedCount: 0, deleteFailures: 0 });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('ignores a registered base.ipa — only .upload-* temp objects are ever stale', async () => {
    const storage = fakeStorage([
      { key: 'shell-base/1.0.0/base.ipa', lastModified: new Date(Date.now() - 2 * DAY_MS) },
      { key: 'shell-base/1.0.0/manifest.json', lastModified: new Date(Date.now() - 2 * DAY_MS) },
    ]);
    const result = await cleanupStaleShellReleaseUploads(storage);
    expect(result).toEqual({ deletedCount: 0, deleteFailures: 0 });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('ignores an .upload-* object younger than a day', async () => {
    const storage = fakeStorage([
      { key: 'shell-base/1.0.0/base.ipa.upload-abc', lastModified: new Date(Date.now() - 1000) },
    ]);
    const result = await cleanupStaleShellReleaseUploads(storage);
    expect(result).toEqual({ deletedCount: 0, deleteFailures: 0 });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes an .upload-* object older than a day', async () => {
    const key = 'shell-base/1.0.0/base.ipa.upload-abc';
    const storage = fakeStorage([{ key, lastModified: new Date(Date.now() - 2 * DAY_MS) }]);
    const result = await cleanupStaleShellReleaseUploads(storage);
    expect(result).toEqual({ deletedCount: 1, deleteFailures: 0 });
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('counts delete failures without throwing, and still reports the full attempted count', async () => {
    const keyA = 'shell-base/1.0.0/base.ipa.upload-a';
    const keyB = 'shell-base/2.0.0/base.ipa.upload-b';
    const storage = fakeStorage(
      [
        { key: keyA, lastModified: new Date(Date.now() - 2 * DAY_MS) },
        { key: keyB, lastModified: new Date(Date.now() - 2 * DAY_MS) },
      ],
      (key) => (key === keyA ? Promise.reject(new Error('not found')) : Promise.resolve()),
    );
    const result = await cleanupStaleShellReleaseUploads(storage);
    expect(result).toEqual({ deletedCount: 1, deleteFailures: 1 });
  });

  it('lists only the shell-base/ prefix, not the whole bucket', async () => {
    const storage = fakeStorage([]);
    await cleanupStaleShellReleaseUploads(storage);
    expect(storage.list).toHaveBeenCalledWith('shell-base/');
  });
});
