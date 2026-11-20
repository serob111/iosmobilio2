import type { Readable } from 'node:stream';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema, eq, desc } from '@mobilio/db';
import { type ObjectStorage, shellReleaseIpaKey, shellReleaseManifestKey } from '@mobilio/storage';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { createIpaValidationStream } from '../builds/ipa-stream.js';

export type ShellReleaseSummary = {
  id: string;
  version: string;
  sha256: string;
  isActive: boolean;
  createdAt: Date;
};

function toSummary(row: typeof schema.shellReleases.$inferSelect): ShellReleaseSummary {
  return {
    id: row.id,
    version: row.version,
    sha256: row.sha256,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

/**
 * shell_releases has no org/tenant concept at all — one global table of compiled
 * apps/shell base builds, written only by build-shell-base.yml (ShellReleaseAuthGuard)
 * and read by the repack worker (a later phase). Queries go straight through
 * DbService.db, same as Better Auth's own tables — see DbService's own doc comment on
 * why that's fine for tables with no RLS tenant scoping to apply.
 */
@Injectable()
export class ShellReleasesService {
  constructor(
    private readonly dbService: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** POST /internal/shell-releases/:version/ipa — streams straight to S3, no DB row yet (register() creates it). */
  async uploadIpa(version: string, body: Readable): Promise<void> {
    const key = shellReleaseIpaKey(version);
    const validated = body.pipe(createIpaValidationStream());
    await this.storage.putStream(key, validated, 'application/octet-stream');
  }

  /**
   * POST /internal/shell-releases — called after uploadIpa, once the workflow has a
   * manifest.json (including its own locally-computed sha256) to go with it. Writes
   * manifest.json to S3 alongside base.ipa (shell-base/<version>/manifest.json), so the
   * same object a human or script downloads to inspect a release is also the one this
   * row's manifest column records — not two independently-maintained copies. Upserts on
   * version rather than rejecting a repeat registration: a workflow re-run against the
   * same tag (e.g. retrying after a transient S3 failure) re-uploads the same version's
   * .ipa and should just overwrite the earlier attempt's metadata, not 409.
   */
  async register(
    version: string,
    manifest: Record<string, unknown>,
    sha256: string,
  ): Promise<ShellReleaseSummary> {
    const ipaKey = shellReleaseIpaKey(version);
    await this.storage.put(
      shellReleaseManifestKey(version),
      Buffer.from(JSON.stringify(manifest, null, 2)),
      'application/json',
    );
    const [row] = await this.dbService.db
      .insert(schema.shellReleases)
      .values({ version, ipaKey, manifest, sha256, isActive: false })
      .onConflictDoUpdate({
        target: schema.shellReleases.version,
        set: { ipaKey, manifest, sha256 },
      })
      .returning();
    return toSummary(row);
  }

  /**
   * POST /internal/shell-releases/:version/activate — the only way a release becomes
   * the one the repack worker uses; never automatic on register() (see register()'s own
   * isActive: false), so a bad base build never goes live just by finishing CI.
   * Deactivating every other row first, in the same transaction, is what the
   * shell_releases_one_active partial unique index actually depends on — without it,
   * activating a second release while the first is still active would violate that
   * index instead of swapping cleanly.
   */
  async activate(version: string): Promise<ShellReleaseSummary> {
    return this.dbService.db.transaction(async (tx) => {
      const [release] = await tx.select().from(schema.shellReleases).where(eq(schema.shellReleases.version, version));
      if (!release) {
        throw new NotFoundException({
          code: 'SHELL_RELEASE_NOT_FOUND',
          message: `No shell release registered for version ${version}`,
        });
      }
      await tx.update(schema.shellReleases).set({ isActive: false }).where(eq(schema.shellReleases.isActive, true));
      const [activated] = await tx
        .update(schema.shellReleases)
        .set({ isActive: true })
        .where(eq(schema.shellReleases.id, release.id))
        .returning();
      return toSummary(activated);
    });
  }

  async getActive(): Promise<ShellReleaseSummary | undefined> {
    const [row] = await this.dbService.db.select().from(schema.shellReleases).where(eq(schema.shellReleases.isActive, true));
    return row ? toSummary(row) : undefined;
  }

  async list(): Promise<ShellReleaseSummary[]> {
    const rows = await this.dbService.db.select().from(schema.shellReleases).orderBy(desc(schema.shellReleases.createdAt));
    return rows.map(toSummary);
  }
}
