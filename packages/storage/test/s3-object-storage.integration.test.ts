import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { createObjectStorageFromEnv, ObjectNotFoundError, S3ObjectStorage, type ObjectStorage } from '../src/object-storage';

// Only runs against a real S3-compatible endpoint (MinIO in docker-compose/CI). Locally
// this just skips: plain `npm test` shouldn't require live infrastructure. In CI,
// REQUIRE_LIVE_SERVICES=true turns a missing env var into a hard failure instead of a
// silent skip — a misconfigured job should never pass by quietly running 0 tests.
const hasLiveS3 =
  Boolean(process.env.S3_ENDPOINT) && Boolean(process.env.S3_BUCKET) && Boolean(process.env.S3_ACCESS_KEY_ID);
if (!hasLiveS3 && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID are not set');
}

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

  it('delete removes the object', async () => {
    const deleteKey = `test/s3-object-storage-delete-${Date.now()}.txt`;
    await storage.put(deleteKey, Buffer.from('bye'), 'text/plain');
    await storage.delete(deleteKey);
    await expect(storage.get(deleteKey)).rejects.toThrow(ObjectNotFoundError);
  });

  it('get throws ObjectNotFoundError for a key that was never written', async () => {
    const missingKey = `test/s3-object-storage-missing-${Date.now()}.txt`;
    await expect(storage.get(missingKey)).rejects.toThrow(ObjectNotFoundError);
  });

  it('putStream multipart-uploads a large stream, and the full content round-trips', async () => {
    // Bigger than lib-storage's default 5MB part size, so this genuinely exercises a
    // multipart upload rather than falling back to a single PutObject under the hood.
    const size = 6 * 1024 * 1024;
    const content = Buffer.alloc(size, 'm');
    const streamKey = `test/s3-object-storage-stream-${Date.now()}.bin`;

    await storage.putStream(streamKey, Readable.from(content), 'application/octet-stream');
    const read = await storage.get(streamKey);
    expect(read.length).toBe(size);
    expect(read.equals(content)).toBe(true);

    await storage.delete(streamKey);
  });

  it('signedUrl produces a GET url that serves the object without extra credentials', async () => {
    await storage.put(key, Buffer.from('hello signed'), 'text/plain');
    const url = await storage.signedUrl(key, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello signed');
  });

  it('signedUrl with a filename sets Content-Disposition so the download keeps that name', async () => {
    await storage.put(key, Buffer.from('hello named'), 'text/plain');
    const url = await storage.signedUrl(key, 60, 'мой файл.ipa');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain("filename*=UTF-8''%D0%BC%D0%BE%D0%B9%20%D1%84%D0%B0%D0%B9%D0%BB.ipa");
  });

  // S3_PUBLIC_ENDPOINT exists because, inside docker-compose, api/worker reach MinIO at
  // the internal `http://minio:9000` for put/get/delete, but a signed URL is handed to a
  // browser, which can't resolve that hostname — it needs the host-mapped address
  // instead. Proven here by configuring `endpoint` with a hostname that doesn't resolve
  // at all and `publicEndpoint` with the real one: presigning is a local, offline
  // signature computation (no network call), so it would "succeed" either way — the
  // only way to actually prove the right host was used is to check the signed URL's
  // origin, and that fetching it for real still works.
  it('signedUrl uses S3_PUBLIC_ENDPOINT, not the (possibly internal-only) S3_ENDPOINT', async () => {
    await storage.put(key, Buffer.from('hello public endpoint'), 'text/plain');

    const publicEndpoint = process.env.S3_ENDPOINT!;
    const dualEndpointStorage = new S3ObjectStorage({
      endpoint: 'http://minio-internal-only.invalid:9000',
      publicEndpoint,
      region: process.env.S3_REGION ?? 'auto',
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    });

    const url = await dualEndpointStorage.signedUrl(key, 60);
    expect(new URL(url).origin).toBe(new URL(publicEndpoint).origin);

    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello public endpoint');
  });
});
