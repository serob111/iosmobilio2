import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  runInTenantContext,
  runInTokenLookupContext,
  runInPreviewLookupContext,
  getTenantDb,
  schema,
  eq,
  and,
  isNull,
} from '@mobilio/db';
import type { ProjectConfig } from '@mobilio/config';
import { type ObjectStorage, projectIconKey, draftIconKey } from '@mobilio/storage';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { generatePreviewSlug, hashPreviewSlug } from './preview-slug.js';

export type PreviewDto = {
  name: string;
  theme: ProjectConfig['theme'];
  statusBar: ProjectConfig['theme']['statusBar'];
  tabs: ProjectConfig['tabs'];
  iconUrl: string;
  proxyBase: string;
};

function previewUrl(rawSlug: string): string {
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  return `${webOrigin}/preview/${rawSlug}`;
}

function proxyBase(rawSlug: string): string {
  const proxyOrigin = process.env.PREVIEW_PROXY_ORIGIN ?? '';
  return `${proxyOrigin}/s/${rawSlug}`;
}

@Injectable()
export class PreviewLinkService {
  constructor(
    private readonly dbService: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * POST /orgs/:orgId/projects/:projectId/preview-link — regenerating revokes whatever
   * active link already exists first (not insert-and-catch-conflict): both statements run
   * inside the same tenant transaction, so a crash between them just leaves no active
   * link at all (safe — a client that didn't get a response will retry), never two.
   */
  async createForProject(orgId: string, userId: string, projectId: string): Promise<{ url: string }> {
    const { rawSlug, slugHash } = generatePreviewSlug();
    await runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      await tx
        .update(schema.previewLinks)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.previewLinks.projectId, projectId), isNull(schema.previewLinks.revokedAt)));
      await tx.insert(schema.previewLinks).values({ orgId, projectId, slugHash });
    });
    return { url: previewUrl(rawSlug) };
  }

  /**
   * POST /drafts/me/preview-link — expiresAt mirrors the draft's own expiry exactly, so
   * the link stops resolving (preview_links_slug_lookup, 0014) the moment the draft would
   * anyway, without needing a separate sweep. If the draft is later claimed into a
   * project, the draft row's deletion (DraftsService.claimDraft) cascades to this row
   * too (preview_links.draft_id references drafts.id ON DELETE CASCADE) — no explicit
   * revoke call needed there.
   */
  async createForDraft(tokenHash: string, draftId: string, draftExpiresAt: Date): Promise<{ url: string }> {
    const { rawSlug, slugHash } = generatePreviewSlug();
    await runInTokenLookupContext(this.dbService.db, tokenHash, async () => {
      const tx = getTenantDb();
      await tx
        .update(schema.previewLinks)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.previewLinks.draftId, draftId), isNull(schema.previewLinks.revokedAt)));
      await tx.insert(schema.previewLinks).values({ draftId, slugHash, expiresAt: draftExpiresAt });
    });
    return { url: previewUrl(rawSlug) };
  }

  /**
   * GET /preview/:slug (@Public) — the only fields a browser rendering the shell needs;
   * never org_id/project_id/draft_id/bundleId/allowedDomains/privacyPolicyUrl/trial or any
   * other part of the raw config. `theme`/`statusBar` overlap (statusBar already lives
   * inside theme) is deliberate, not a mistake — some shell consumers want the whole theme
   * object, some just want the one field, and duplicating a few bytes costs nothing.
   */
  async getPreviewDto(rawSlug: string): Promise<PreviewDto> {
    const slugHash = hashPreviewSlug(rawSlug);
    const dto = await runInPreviewLookupContext(this.dbService.db, slugHash, async (link) => {
      if (link.projectId) {
        const [project] = await getTenantDb().select().from(schema.projects).where(eq(schema.projects.id, link.projectId));
        if (!project) return undefined;
        const iconUrl = await this.storage.signedUrl(projectIconKey(project.orgId, project.id), 300, 'icon.png');
        return this.toDto(project.config as ProjectConfig, iconUrl, rawSlug);
      }
      const [draft] = await getTenantDb().select().from(schema.drafts).where(eq(schema.drafts.id, link.draftId!));
      if (!draft) return undefined;
      const iconUrl = await this.storage.signedUrl(draftIconKey(draft.id), 300, 'icon.png');
      return this.toDto(draft.config as ProjectConfig, iconUrl, rawSlug);
    });
    if (!dto) {
      throw new NotFoundException({ code: 'PREVIEW_NOT_FOUND', message: 'Preview not found' });
    }
    return dto;
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
