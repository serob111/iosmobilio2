import path from 'node:path';
import os from 'node:os';

/**
 * Shared between playwright.config.ts (passed to the apps/api webServer as
 * MAIL_LOG_FILE) and auth.spec.ts (reads it back) — both need to agree on the same
 * path without relying on env-var propagation timing, since the config file runs
 * before any webServer starts.
 */
export const MAIL_LOG_FILE = path.join(os.tmpdir(), 'mobilio-e2e-mail.ndjson');
