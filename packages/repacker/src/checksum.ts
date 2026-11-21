import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { RepackError } from './errors.js';

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/**
 * The worker (a later phase) is about to repack bytes that claim to be a specific,
 * already-vetted shell_releases row — this is what stops it from repacking a base
 * .ipa that's been swapped out, truncated, or otherwise doesn't match the sha256 that
 * row recorded at registration time.
 */
export async function assertBaseChecksum(baseIpaPath: string, expectedSha256: string): Promise<void> {
  const actual = await sha256File(baseIpaPath);
  if (actual !== expectedSha256) {
    throw new RepackError(
      'BASE_CHECKSUM_MISMATCH',
      `base .ipa at ${baseIpaPath} has sha256 ${actual}, expected ${expectedSha256}`,
    );
  }
}
