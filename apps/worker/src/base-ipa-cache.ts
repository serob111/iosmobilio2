import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ObjectStorage } from '@mobilio/storage';
import { sha256File } from '@mobilio/repacker';

export type BaseIpaCacheConfig = { cacheDir: string };

/**
 * Local disk cache for the active shell_releases base.ipa, keyed by its own sha256 —
 * every repack build of the same shell_releases version downloads the identical
 * base.ipa, and re-fetching it from S3 on every single build would undercut the whole
 * point of a "compile the base once, repack per client" architecture. Re-verifies the
 * cached file's hash before trusting it (never just "the file exists at this path"),
 * so a corrupted or partial previous download can never be silently reused — on a
 * mismatch this falls through and re-downloads rather than failing outright.
 *
 * Downloads to a per-attempt temp path and renames into place atomically only after the
 * freshly-downloaded content's own hash is confirmed — so a second repack job racing a
 * cache miss for the same version never observes a partially-written file at the real
 * cache path, even without an explicit lock between them.
 */
export async function getCachedBaseIpa(
  storage: ObjectStorage,
  ipaKey: string,
  expectedSha256: string,
  config: BaseIpaCacheConfig,
): Promise<string> {
  await mkdir(config.cacheDir, { recursive: true });
  const cachedPath = join(config.cacheDir, `${expectedSha256}.ipa`);

  if (existsSync(cachedPath)) {
    const actual = await sha256File(cachedPath);
    if (actual === expectedSha256) {
      return cachedPath;
    }
  }

  const tmpPath = `${cachedPath}.download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const readStream = await storage.getStream(ipaKey);
    await pipeline(readStream, createWriteStream(tmpPath));

    const actual = await sha256File(tmpPath);
    if (actual !== expectedSha256) {
      throw new Error(`Downloaded base.ipa sha256 mismatch for ${ipaKey}: expected ${expectedSha256}, got ${actual}`);
    }
    await rename(tmpPath, cachedPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }

  return cachedPath;
}
