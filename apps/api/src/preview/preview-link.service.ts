import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  runInTenantContext,
  runInTokenLookupContext,
  runInPreviewLookupContext,
  getTenantDb,
  schema,
  eq,
  and,
  isNull,
  type Db,
} from '@mobilio/db';
import type { ProjectConfig } from '@mobilio/config';
import { type ObjectStorage, projectIconKey, draftIconKey } from '@mobilio/storage';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { generatePreviewSlug, hashPreviewSlug } from './preview-slug.js';
import { encryptPreviewSlug, decryptPreviewSlug } from './preview-slug-crypto.js';
import { previewProxyOrigin } from './validate-preview-env.js';

export type PreviewDto = {
  name: string;
  theme: ProjectConfig['theme'];
  statusBar: ProjectConfig['theme']['statusBar'];
  tabs: ProjectConfig['tabs'];
  iconUrl: string;
  proxyBase: string;
};

const EDITOR_LINK_LIFETIME_MS = 2 * 60 * 60 * 1000;

function previewUrl(rawSlug: string): string {
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  return `${webOrigin}/preview/${rawSlug}`;
}

function proxyBase(rawSlug: string): string {
  return previewProxyOrigin(rawSlug);
}

/** Exactly one of these two is ever set — mirrors the table's own exactly-one-owner CHECK. */
type Owner = { projectId: string; orgId: string } | { draftId: string };

function ownerWhere(owner: Owner) {
  return 'projectId' in owner
    ? eq(schema.previewLinks.projectId, owner.projectId)
    : eq(schema.previewLinks.draftId, owner.draftId);
}

/**
 * Both preview_links_one_active_share_per_project/_draft (0017) are hit by the exact
 * same race: two concurrent POSTs both pass the "is one already active" check, then
 * both attempt the insert — whichever loses gets this, the DB-level backstop behind the
 * check-then-insert above.
 */
function isActiveShareLinkConflict(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;
  return (
    cause?.code === '23505' &&
    (cause?.constraint === 'preview_links_one_active_share_per_project' ||
      cause?.constraint === 'preview_links_one_active_share_per_draft')
  );
}

type ShareLinkLookup = { status: 'ok'; url: string } | { status: 'none' } | { status: 'broken'; rowId: string };

@Injectable()
export class PreviewLinkService {
  private readonly logger = new Logger(PreviewLinkService.name);

  constructor(
    private readonly dbService: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Looks up the currently-active (not revoked, not expired) 'share' link for this
   * owner, if any — used both by the GET endpoint (redisplay) and by "create if none
   * active" (to decide whether to actually insert a new row). A row with no slug_enc, or
   * one that fails to decrypt (e.g. PREVIEW_SLUG_KEY was rotated after it was written),
   * is reported as 'broken' rather than silently treated the same as 'none': the GET
   * endpoint still 404s for it either way, but a caller that's about to *insert* a
   * replacement needs to know there's a row occupying the one-active-share slot that it
   * must revoke first, or the insert will violate the partial unique index. Never logs
   * the ciphertext itself, only the row id.
   */
  private async lookupActiveShareLink(owner: Owner): Promise<ShareLinkLookup> {
    const [row] = await getTenantDb()
      .select()
      .from(schema.previewLinks)
      .where(and(ownerWhere(owner), eq(schema.previewLinks.kind, 'share'), isNull(schema.previewLinks.revokedAt)));
    if (!row) return { status: 'none' };
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { status: 'none' };
    if (!row.slugEnc) {
      this.logger.warn({ previewLinkId: row.id }, 'active share link has no slug_enc');
      return { status: 'broken', rowId: row.id };
    }
    try {
      return { status: 'ok', url: previewUrl(decryptPreviewSlug(row.slugEnc)) };
    } catch {
      this.logger.warn({ previewLinkId: row.id }, 'failed to decrypt active share link slug (PREVIEW_SLUG_KEY rotated?)');
      return { status: 'broken', rowId: row.id };
    }
  }

  /**
   * Inserts a fresh share link inside its own nested transaction (a Postgres SAVEPOINT,
   * via drizzle's own nested .transaction() — not a second top-level transaction): if the
   * insert loses a concurrent race against the partial unique index, only this savepoint
   * rolls back, not the whole outer runInTenantContext/runInTokenLookupContext
   * transaction — the reread that follows still runs inside that outer transaction/
   * context. Without the savepoint, the unique-violation error would instead abort the
   * *entire* surrounding transaction at the Postgres level, and the reread would just
   * fail too ("current transaction is aborted").
   */
  private async insertShareLinkOrReread(owner: Owner, expiresAt?: Date): Promise<{ url: string }> {
    const db = getTenantDb() as unknown as Db;
    try {
      return await db.transaction((tx) => this.insertShareLink(tx as unknown as Db, owner, expiresAt));
    } catch (error) {
      if (!isActiveShareLinkConflict(error)) throw error;
      const retry = await this.lookupActiveShareLink(owner);
      if (retry.status === 'ok') return { url: retry.url };
      throw error;
    }
  }

  private async insertShareLink(db: Db, owner: Owner, expiresAt?: Date): Promise<{ url: string }> {
    const { rawSlug, slugHash } = generatePreviewSlug();
    const slugEnc = encryptPreviewSlug(rawSlug);
    await db.insert(schema.previewLinks).values({ ...owner, kind: 'share', slugHash, slugEnc, expiresAt });
    return { url: previewUrl(rawSlug) };
  }

  private async revokeActiveShareLink(owner: Owner): Promise<void> {
    await getTenantDb()
      .update(schema.previewLinks)
      .set({ revokedAt: new Date() })
      .where(and(ownerWhere(owner), eq(schema.previewLinks.kind, 'share'), isNull(schema.previewLinks.revokedAt)));
  }

  private async insertEditorLink(owner: Owner): Promise<{ url: string }> {
    const { rawSlug, slugHash } = generatePreviewSlug();
    await getTenantDb()
      .insert(schema.previewLinks)
      .values({ ...owner, kind: 'editor', slugHash, expiresAt: new Date(Date.now() + EDITOR_LINK_LIFETIME_MS) });
    return { url: previewUrl(rawSlug) };
  }

  // --- editor links: created every time the editor page loads, never revoke anything ---

  async createEditorLinkForProject(orgId: string, userId: string, projectId: string): Promise<{ url: string }> {
    return runInTenantContext(this.dbService.db, { orgId, userId }, () =>
      this.insertEditorLink({ projectId, orgId }),
    );
  }

  async createEditorLinkForDraft(tokenHash: string, draftId: string): Promise<{ url: string }> {
    return runInTokenLookupContext(this.dbService.db, tokenHash, () => this.insertEditorLink({ draftId }));
  }

  // --- share links: at most one active at a time, explicitly fetched/created/regenerated ---

  /** GET .../preview-link — 404s (PREVIEW_LINK_NOT_FOUND) if nothing is currently active (including a 'broken' row — this never mutates). */
  async getActiveShareLinkForProject(orgId: string, userId: string, projectId: string): Promise<{ url: string }> {
    const lookup = await runInTenantContext(this.dbService.db, { orgId, userId }, () =>
      this.lookupActiveShareLink({ projectId, orgId }),
    );
    if (lookup.status !== 'ok') throw new NotFoundException({ code: 'PREVIEW_LINK_NOT_FOUND', message: 'No active share link' });
    return { url: lookup.url };
  }

  async getActiveShareLinkForDraft(tokenHash: string, draftId: string): Promise<{ url: string }> {
    const lookup = await runInTokenLookupContext(this.dbService.db, tokenHash, () =>
      this.lookupActiveShareLink({ draftId }),
    );
    if (lookup.status !== 'ok') throw new NotFoundException({ code: 'PREVIEW_LINK_NOT_FOUND', message: 'No active share link' });
    return { url: lookup.url };
  }

  /**
   * POST .../preview-link — returns the existing active share link if there is one,
   * otherwise creates it. A 'broken' active row (undecryptable/missing slug_enc) is
   * revoked first, in the same transaction, so the insert that follows doesn't collide
   * with it on the partial unique index.
   */
  async createShareLinkForProject(orgId: string, userId: string, projectId: string): Promise<{ url: string }> {
    return runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const lookup = await this.lookupActiveShareLink({ projectId, orgId });
      if (lookup.status === 'ok') return { url: lookup.url };
      if (lookup.status === 'broken') await this.revokeActiveShareLink({ projectId, orgId });
      return this.insertShareLinkOrReread({ projectId, orgId });
    });
  }

  async createShareLinkForDraft(tokenHash: string, draftId: string, draftExpiresAt: Date): Promise<{ url: string }> {
    return runInTokenLookupContext(this.dbService.db, tokenHash, async () => {
      const lookup = await this.lookupActiveShareLink({ draftId });
      if (lookup.status === 'ok') return { url: lookup.url };
      if (lookup.status === 'broken') await this.revokeActiveShareLink({ draftId });
      return this.insertShareLinkOrReread({ draftId }, draftExpiresAt);
    });
  }

  /** POST .../preview-link/regenerate — always revokes whatever's active first, then creates a new one. */
  async regenerateShareLinkForProject(orgId: string, userId: string, projectId: string): Promise<{ url: string }> {
    return runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      await this.revokeActiveShareLink({ projectId, orgId });
      return this.insertShareLinkOrReread({ projectId, orgId });
    });
  }

  async regenerateShareLinkForDraft(tokenHash: string, draftId: string, draftExpiresAt: Date): Promise<{ url: string }> {
    return runInTokenLookupContext(this.dbService.db, tokenHash, async () => {
      await this.revokeActiveShareLink({ draftId });
      return this.insertShareLinkOrReread({ draftId }, draftExpiresAt);
    });
  }

  /**
   * GET /preview/:slug (@Public) — the only fields a browser rendering the shell needs;
   * never org_id/project_id/draft_id/bundleId/allowedDomains/privacyPolicyUrl/trial or any
   * other part of the raw config. `theme`/`statusBar` overlap (statusBar already lives
   * inside theme) is deliberate, not a mistake — some shell consumers want the whole theme
   * object, some just want the one field, and duplicating a few bytes costs nothing.
   * Kind-agnostic on purpose: an 'editor' link's slug works here identically to a 'share'
   * one — the distinction only governs how a link is created/revoked, not whether a valid,
   * active one may be read.
   */
  async getPreviewDto(rawSlug: string): Promise<PreviewDto> {
    const slugHash = hashPreviewSlug(rawSlug);
    const dto = await runInPreviewLookupContext(this.dbService.db, slugHash, async (link) => {
      const target = await this.loadLinkTarget(link);
      if (!target) return undefined;
      const iconUrl = await this.storage.signedUrl(target.iconKey, 300, 'icon.png');
      return this.toDto(target.config, iconUrl, rawSlug);
    });
    if (!dto) {
      throw new NotFoundException({ code: 'PREVIEW_NOT_FOUND', message: 'Preview not found' });
    }
    return dto;
  }

  /**
   * Used by the preview proxy middleware to learn which real site a slug's link actually
   * points at. Returns undefined for the same cases getPreviewDto 404s on (unknown/
   * revoked/expired slug, missing project/draft row) *and* for a config whose source
   * isn't `{type:'url'}` — a raw-HTML-upload source has no live site to fetch at all, so
   * there's nothing this proxy can meaningfully do with it. Every project/draft actually
   * reachable through this api's own `POST /drafts` (DraftsService) always writes a
   * `{type:'url'}` source — the `html` variant exists in the schema for a different,
   * legacy upload path that this proxy was never asked to support.
   */
  async resolveProxySource(rawSlug: string): Promise<{ sourceUrl: string } | undefined> {
    const slugHash = hashPreviewSlug(rawSlug);
    return runInPreviewLookupContext(this.dbService.db, slugHash, async (link) => {
      const target = await this.loadLinkTarget(link);
      if (!target || target.config.source.type !== 'url') return undefined;
      return { sourceUrl: target.config.source.url };
    });
  }

  private async loadLinkTarget(
    link: typeof schema.previewLinks.$inferSelect,
  ): Promise<{ config: ProjectConfig; iconKey: string } | undefined> {
    if (link.projectId) {
      const [project] = await getTenantDb().select().from(schema.projects).where(eq(schema.projects.id, link.projectId));
      if (!project) return undefined;
      return { config: project.config as ProjectConfig, iconKey: projectIconKey(project.orgId, project.id) };
    }
    const [draft] = await getTenantDb().select().from(schema.drafts).where(eq(schema.drafts.id, link.draftId!));
    if (!draft) return undefined;
    return { config: draft.config as ProjectConfig, iconKey: draftIconKey(draft.id) };
  }

  private toDto(config: ProjectConfig, iconUrl: string, rawSlug: string): PreviewDto {
    return {
      name: config.name,
      theme: config.theme,
      statusBar: config.theme.statusBar,
      tabs: config.tabs,
      iconUrl,
      proxyBase: proxyBase(rawSlug),
    };
  }
}
