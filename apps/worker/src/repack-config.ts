import { validateAppleEnv } from '@mobilio/apple';
import type { RepackJobConfig } from './repack-job.js';

const DEFAULT_CACHE_DIR = '/tmp/mobilio-repack-cache';

/**
 * Called only when REPACK_ENABLED=true (see index.ts) — every env var here is on top
 * of what @mobilio/apple's validateAppleEnv already requires, so a dev/CI environment
 * that never sets REPACK_ENABLED never has to configure any of this (RCODESIGN_PATH/
 * RCODESIGN_SHA256 included), matching apps/worker/.env.example's own framing of these
 * vars as "not required for anything this worker does today".
 */
export function loadRepackJobConfig(env: Record<string, string | undefined> = process.env): RepackJobConfig {
  const binaryPath = env.RCODESIGN_PATH;
  const expectedSha256 = env.RCODESIGN_SHA256;
  const missing = [
    !binaryPath ? 'RCODESIGN_PATH' : undefined,
    !expectedSha256 ? 'RCODESIGN_SHA256' : undefined,
  ].filter((name): name is string => Boolean(name));
  if (missing.length > 0) {
    throw new Error(`REPACK_ENABLED=true but missing required env var(s): ${missing.join(', ')}`);
  }

  return {
    cacheDir: env.REPACK_CACHE_DIR ?? DEFAULT_CACHE_DIR,
    rcodesign: { binaryPath: binaryPath!, expectedSha256: expectedSha256! },
    appleEnv: validateAppleEnv(env),
  };
}
