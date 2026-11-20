import type { ObjectStorage } from '@mobilio/storage';

export type ShellReleaseUploadsCleanupResult = { deletedCount: number; deleteFailures: number };

const SHELL_BASE_PREFIX = 'shell-base/';
const UPLOAD_MARKER = '.upload-';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Sweeps shell-base/<version>/base.ipa.upload-<uploadId> objects left behind by an
 * uploadIpa() call that was never followed by a matching register() — e.g. the
 * workflow died between the two steps, or register() rejected the upload
 * (SHA256_MISMATCH) and its own best-effort delete there also failed.
 * register()'s own happy path already deletes its upload object immediately on
 * success; this is the backstop for everything that doesn't reach that point, not the
 * primary cleanup mechanism — which is why a day's grace period is fine here, unlike
 * the hourly urgency cleanupExpiredDrafts has.
 */
export async function cleanupStaleShellReleaseUploads(storage: ObjectStorage): Promise<ShellReleaseUploadsCleanupResult> {
  const objects = await storage.list(SHELL_BASE_PREFIX);
  const cutoff = Date.now() - STALE_AFTER_MS;
  const stale = objects.filter((object) => object.key.includes(UPLOAD_MARKER) && object.lastModified.getTime() < cutoff);

  const outcomes = await Promise.allSettled(stale.map((object) => storage.delete(object.key)));
  return {
    deletedCount: outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    deleteFailures: outcomes.filter((outcome) => outcome.status === 'rejected').length,
  };
}
