import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema, eq, desc } from '@mobilio/db';
import { type ObjectStorage, shellReleaseIpaKey, shellReleaseManifestKey, shellReleaseUploadKey } from '@mobilio/storage';
import { uuidv7 } from 'uuidv7';
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

export type RegisterResult = { status: 'created' | 'unchanged'; release: ShellReleaseSummary };

function toSummary(row: typeof schema.shellReleases.$inferSelect): ShellReleaseSummary {
  return {
    id: row.id,
    version: row.version,
    sha256: row.sha256,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

async function computeStreamSha256(stream: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** Postgres' own unique-violation on shell_releases_version_unique — the real backstop against two concurrent registrations of the same brand-new version racing past the SELECT-then-INSERT check below. */
function isShellReleaseVersionConflict(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;
  return cause?.code === '23505' && cause?.constraint === 'shell_releases_version_unique';
}

/**
 * shell_releases has no org/tenant concept at all — one global table of compiled
 * apps/shell base builds, written only by build-shell-base.yml (ShellReleaseAuthGuard)
 * and read by the repack worker (a later phase). Queries go straight through
 * DbService.db, same as Better Auth's own tables — see DbService's own doc comment on
 * why that's fine for tables with no RLS tenant scoping to apply.
 *
 * Every registered version is immutable: once a row exists, neither uploadIpa() nor
 * register() can ever change its content or sha256 — only add a brand-new version.
 * This is what lets the repack worker (a later phase) treat a shell_releases row as
 * safe to cache indefinitely by sha256 alone, never re-fetching "just in case".
 */
@Injectable()
export class ShellReleasesService {
  constructor(
    private readonly dbService: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * POST /internal/shell-releases/:version/ipa — streams to a *temporary* key
   * (shellReleaseUploadKey), never the permanent one. register() is the only thing
   * that ever promotes an upload to shellReleaseIpaKey, and only after independently
   * re-hashing it. Rejects outright, without touching S3 at all, if this version is
   * already registered — re-uploading for an existing version is never valid, whether
   * or not the new bytes would even match.
   */
  async uploadIpa(version: string, body: Readable): Promise<{ uploadId: string }> {
    const [existing] = await this.dbService.db
      .select()
      .from(schema.shellReleases)
      .where(eq(schema.shellReleases.version, version));
    if (existing) {
      throw new ConflictException({
        code: 'SHELL_RELEASE_IMMUTABLE',
        message: `Version ${version} is already registered and cannot be re-uploaded`,
      });
    }

    const uploadId = uuidv7();
    const validated = body.pipe(createIpaValidationStream());
    await this.storage.putStream(shellReleaseUploadKey(version, uploadId), validated, 'application/octet-stream');
    return { uploadId };
  }

  /**
   * POST /internal/shell-releases — called after uploadIpa, once the workflow has a
   * manifest.json (including its own locally-computed sha256) to go with it.
   *
   * - New version: re-reads the uploadId's temp object and independently computes its
   *   sha256 — if that doesn't match the claimed sha256, rejects (SHA256_MISMATCH)
   *   without creating anything. Only on a match does it copy (server-side, no bytes
   *   through this process) the temp object to its permanent key, write manifest.json
   *   alongside it, and insert the row.
   * - Already-registered version, same sha256: returns the existing row unchanged —
   *   this is what makes a workflow re-run (e.g. retrying after its own transient
   *   failure between upload and register) idempotent rather than erroring.
   * - Already-registered version, different sha256: rejects (SHELL_RELEASE_IMMUTABLE).
   *   The existing row's content/sha256 never changes.
   */
  async register(
    version: string,
    manifest: Record<string, unknown>,
    sha256: string,
    uploadId: string | undefined,
  ): Promise<RegisterResult> {
    const [existing] = await this.dbService.db
      .select()
      .from(schema.shellReleases)
      .where(eq(schema.shellReleases.version, version));
    if (existing) {
      if (existing.sha256 === sha256) {
        return { status: 'unchanged', release: toSummary(existing) };
      }
      throw new ConflictException({
        code: 'SHELL_RELEASE_IMMUTABLE',
        message: `Version ${version} is already registered with a different sha256`,
      });
    }

    if (!uploadId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'uploadId is required to register a new version',
      });
    }
    const uploadKey = shellReleaseUploadKey(version, uploadId);
    const uploadedStream = await this.storage.getStream(uploadKey);
    const actualSha256 = await computeStreamSha256(uploadedStream);
    if (actualSha256 !== sha256) {
      throw new BadRequestException({
        code: 'SHA256_MISMATCH',
        message: 'The uploaded file does not match the provided sha256',
      });
    }

    const ipaKey = shellReleaseIpaKey(version);
    await this.storage.copy(uploadKey, ipaKey);
    await this.storage.delete(uploadKey).catch(() => {});
    await this.storage.put(
      shellReleaseManifestKey(version),
      Buffer.from(JSON.stringify(manifest, null, 2)),
      'application/json',
    );

    try {
      const [row] = await this.dbService.db
        .insert(schema.shellReleases)
        .values({ version, ipaKey, manifest, sha256, isActive: false })
        .returning();
      return { status: 'created', release: toSummary(row) };
    } catch (error) {
      if (!isShellReleaseVersionConflict(error)) {
        throw error;
      }
      // Lost a race against a concurrent registration of the same brand-new version —
      // the winner's row is now the source of truth; re-apply the same same-vs-
      // different-sha256 logic against it rather than surfacing a raw 500.
      const [winner] = await this.dbService.db
        .select()
        .from(schema.shellReleases)
        .where(eq(schema.shellReleases.version, version));
      if (winner?.sha256 === sha256) {
        return { status: 'unchanged', release: toSummary(winner) };
      }
      throw new ConflictException({
        code: 'SHELL_RELEASE_IMMUTABLE',
        message: `Version ${version} is already registered with a different sha256`,
      });
    }
  }

  /**
   * POST /internal/shell-releases/:version/activate — the only way a release becomes
   * the one the repack worker uses; never automatic on register() (see register()'s own
   * isActive: false), so a bad base build never goes live just by finishing CI.
   * Deactivating every other row first, in the same transaction, is what the
   * shell_releases_one_active partial unique index actually depends on — without it,
   * activating a second release while the first is still active would violate that
   * index instead of swapping cleanly. Never touches a release's own ipaKey/sha256 —
   * activation only ever flips isActive.
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
