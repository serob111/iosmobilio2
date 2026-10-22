import { afterAll, describe, expect, it } from 'vitest';
import { createObjectStorageFromEnv, type ObjectStorage } from '../src/object-storage';

// Only runs against a real S3-compatible endpoint (MinIO in docker-compose/CI). Locally
// this just skips: plain `npm test` shouldn't require live infrastructure.
const hasLiveS3 =
  Boolean(process.env.S3_ENDPOINT) && Boolean(process.env.S3_BUCKET) && Boolean(process.env.S3_ACCESS_KEY_ID);

describe.skipIf(!hasLiveS3)('S3ObjectStorage (live MinIO)', () => {
  // Guarded by the same hasLiveS3 check, not just the describe.skipIf above — the
  // describe callback body (where this runs) still executes during test collection even
  // when the suite is skipped, so an eager env-validation call here would throw and fail
  // collection regardless of skipIf.
  const storage: ObjectStorage = hasLiveS3 ? createObjectStorageFromEnv() : (null as unknown as ObjectStorage);
  const key = `test/s3-object-storage-${Date.now()}.txt`;

  afterAll(async () => {
    await storage.delete(key);
  });

  it('round-trips put -> get', async () => {
    await storage.put(key, Buffer.from('hello mobilio'), 'text/plain');
    const read = await storage.get(key);
    expect(read.toString('utf8')).toBe('hello mobilio');
  });

  it('signedUrl produces a GET url that serves the object without extra credentials', async () => {
    await storage.put(key, Buffer.from('hello signed'), 'text/plain');
    const url = await storage.signedUrl(key, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello signed');
  });

  it('delete removes the object', async () => {
    const deleteKey = `test/s3-object-storage-delete-${Date.now()}.txt`;
    await storage.put(deleteKey, Buffer.from('bye'), 'text/plain');
    await storage.delete(deleteKey);
    await expect(storage.get(deleteKey)).rejects.toThrow();
  });
});
