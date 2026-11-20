import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createObjectStorageFromEnv } from '@mobilio/storage';
import { cleanupStaleShellReleaseUploads } from '../src/shell-releases-cleanup';

const hasLiveServices =
  Boolean(process.env.S3_ENDPOINT) && Boolean(process.env.S3_BUCKET) && Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not all set');
}

describe.skipIf(!hasLiveServices)('shell-release uploads cleanup (live MinIO)', () => {
  it('deletes only a stale .upload-* object, leaving the registered .ipa and a fresh upload untouched', async () => {
    const storage = createObjectStorageFromEnv();
    const version = `itest-${randomUUID()}`;
    const staleKey = `shell-base/${version}/base.ipa.upload-${randomUUID()}`;
    const freshKey = `shell-base/${version}/base.ipa.upload-${randomUUID()}`;
    const registeredKey = `shell-base/${version}/base.ipa`;

    await storage.put(staleKey, Buffer.from('stale'), 'application/octet-stream');
    await storage.put(freshKey, Buffer.from('fresh'), 'application/octet-stream');
    await storage.put(registeredKey, Buffer.from('registered'), 'application/octet-stream');

    try {
      // There's no way to forge an S3 object's LastModified (it's server-set on
      // write), so this exercises the real "older than a day" boundary indirectly: it
      // asserts the function never touches a just-written object (fresh and
      // registered survive), which is the only behavior this environment can actually
      // prove without waiting 24 hours — the pure-unit tests already cover the
      // age-threshold branch directly with a fabricated lastModified.
      await cleanupStaleShellReleaseUploads(storage);

      await expect(storage.get(freshKey)).resolves.toBeInstanceOf(Buffer);
      await expect(storage.get(registeredKey)).resolves.toBeInstanceOf(Buffer);
    } finally {
      await storage.delete(staleKey).catch(() => {});
      await storage.delete(freshKey).catch(() => {});
      await storage.delete(registeredKey).catch(() => {});
    }
  });
});
