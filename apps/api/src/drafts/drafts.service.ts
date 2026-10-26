import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { runInTokenLookupContext, runInClaimContext, getTenantDb, schema, eq, and, gt } from '@mobilio/db';
import {
  CONFIG_SCHEMA_VERSION,
  deriveBundleId,
  parseProjectConfig,
  slugify,
  type ProjectConfig,
  type ProjectConfigInput,
} from '@mobilio/config';
import { ObjectNotFoundError, type ObjectStorage, draftIconKey, projectIconKey } from '@mobilio/storage';
import { uuidv7 } from 'uuidv7';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { analyzeSite, AnalyzeSiteError } from '../projects/analyze-site.js';
import { processIconImage, generateLetterAvatar } from '../projects/icon.js';
import { generateDraftToken, hashDraftToken } from './draft-token.js';

@Injectable()
export class DraftsService {
  private readonly logger = new Logger(DraftsService.name);

  constructor(
    private readonly dbService: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** POST /drafts — no session required; analyzes the site and creates an anonymous, token-owned draft. */
  async createDraft(url: string): Promise<{ rawToken: string }> {
    let analysis;
    try {
      analysis = await analyzeSite(url);
    } catch (error) {
      if (error instanceof AnalyzeSiteError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw new BadRequestException({ code: 'SITE_UNREACHABLE', message: 'Could not load the site' });
    }

    const id = uuidv7();
    const slug = slugify(analysis.name);
    const bundleId = deriveBundleId('am.mobilio.app', slug);

    const configInput: ProjectConfigInput = {
      id,
      name: analysis.name,
      slug,
      bundleId,
      source: { type: 'url', url: analysis.url },
      theme: { primary: analysis.color, background: '#FFFFFF', statusBar: 'dark' },
      tabs: analysis.tabs,
      features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
      allowedDomains: [analysis.hostname],
      trial: true,
    };

    const parsed = parseProjectConfig(configInput);
    if (!parsed.success) {
      // Should be unreachable — configInput is built entirely from analyzeSite's own
      // output plus constants, same as ProjectsService.createProject.
      throw new InternalServerErrorException({
        code: 'INTERNAL_ERROR',
        message: `Не удалось собрать конфигурацию: ${parsed.errors.join('; ')}`,
      });
    }

    const { rawToken, tokenHash, expiresAt } = generateDraftToken();

    // Icon first, insert second: if the insert fails, the draft row never existed, so
    // the icon object has to be cleaned up too rather than left orphaned under an id
    // nothing references.
    await this.storage.put(draftIconKey(id), analysis.iconBuffer, 'image/png');
    try {
      await runInTokenLookupContext(this.dbService.db, tokenHash, () =>
        getTenantDb().insert(schema.drafts).values({
          id,
          name: parsed.data.name,
          sourceUrl: analysis.url,
          config: parsed.data,
          configVersion: CONFIG_SCHEMA_VERSION,
          tokenHash,
          expiresAt,
        }),
      );
    } catch (error) {
      await this.storage.delete(draftIconKey(id)).catch(() => {});
      throw error;
    }

    return { rawToken };
  }

  /**
   * PUT /drafts/me — full config replace, except id/bundleId/trial: those are
   * server-owned and always come from the existing row, never from the request body, so
   * a caller can't quietly change a draft's identity or trial flag by including a
   * different value in an otherwise-ordinary edit.
   */
  async updateDraft(tokenHash: string, draftId: string, body: unknown): Promise<ProjectConfig> {
    const parsed = parseProjectConfig(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: parsed.errors.join('; ') });
    }

    return runInTokenLookupContext(this.dbService.db, tokenHash, async () => {
      const tx = getTenantDb();
      const [existing] = await tx.select().from(schema.drafts).where(eq(schema.drafts.id, draftId));
      if (!existing) {
        throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found or expired' });
      }
      const existingConfig = existing.config as ProjectConfig;
      const finalConfig: ProjectConfig = {
        ...parsed.data,
        id: existingConfig.id,
        bundleId: existingConfig.bundleId,
        trial: existingConfig.trial,
      };

      const source = finalConfig.source;
      await tx
        .update(schema.drafts)
        .set({
          name: finalConfig.name,
          config: finalConfig,
          configVersion: CONFIG_SCHEMA_VERSION,
          // Only a 'url' source carries a URL — an 'html' source leaves the existing
          // column value as-is rather than writing something meaningless over it.
          ...(source.type === 'url' ? { sourceUrl: source.url } : {}),
        })
        .where(eq(schema.drafts.id, draftId));

      return finalConfig;
    });
  }

  /** POST /drafts/me/icon — multipart upload, same sharp pipeline as site analysis/projects. */
  async uploadIcon(draftId: string, file: { buffer: Buffer; mimetype: string }): Promise<void> {
    if (!['image/png', 'image/jpeg'].includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Иконка должна быть в формате PNG или JPEG',
      });
    }

    let iconBuffer: Buffer;
    try {
      iconBuffer = await processIconImage(file.buffer);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Не удалось обработать изображение' });
    }

    await this.storage.put(draftIconKey(draftId), iconBuffer, 'image/png');
  }

  /** GET /drafts/me/icon — a short-lived signed url, not proxied bytes. */
  async getIconUrl(draftId: string): Promise<string> {
    return this.storage.signedUrl(draftIconKey(draftId), 300, 'icon.png');
  }

  /**
   * POST /orgs/:orgId/drafts/claim — moves a draft into the org as a new project.
   *
   * Exactly-once under concurrency: the DELETE ... RETURNING against drafts_token_access
   * (which already requires expires_at > now()) is the FIRST statement in the claiming
   * transaction — whichever concurrent call's DELETE actually returns a row is the one
   * and only winner; every other simultaneous call for the same token gets zero rows
   * back and 404s, never reaching the INSERT. A SELECT-then-INSERT design would let two
   * concurrent calls both see the row before either commits, both think it's theirs, and
   * race the insert into two separate projects.
   *
   * The icon is copied to its new project key BEFORE the claiming transaction opens (a
   * read-only pre-read determines which draft this token currently names, so the key is
   * known up front) — if the claim then loses the race, or the transaction fails
   * outright, the speculative copy is deleted again rather than left as an orphan under
   * a project that was never created. On success, the original draft icon is removed
   * best-effort: the claim has already committed, so a storage cleanup failure here
   * shouldn't fail the request, just get logged.
   */
  async claimDraft(orgId: string, userId: string, rawToken: string): Promise<{ id: string }> {
    const tokenHash = hashDraftToken(rawToken);
    const projectId = uuidv7();

    const preRead = await runInTokenLookupContext(this.dbService.db, tokenHash, async () => {
      const [row] = await getTenantDb().select().from(schema.drafts).where(eq(schema.drafts.tokenHash, tokenHash));
      return row;
    });
    if (!preRead) {
      throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found or expired' });
    }

    let draftIconBuffer: Buffer;
    try {
      draftIconBuffer = await this.storage.get(draftIconKey(preRead.id));
    } catch (error) {
      // Only a genuinely missing object falls back to a generated avatar — any other
      // failure (network error, permission denied, ...) is a real problem that should
      // fail the claim, not get silently papered over with a fake icon.
      if (!(error instanceof ObjectNotFoundError)) {
        throw error;
      }
      const preReadConfig = preRead.config as ProjectConfig;
      draftIconBuffer = await generateLetterAvatar(preRead.name.charAt(0) || '?', preReadConfig.theme.primary);
    }
    await this.storage.put(projectIconKey(orgId, projectId), draftIconBuffer, 'image/png');

    let claimedDraftId: string;
    try {
      const claimed = await runInClaimContext(this.dbService.db, { orgId, userId, tokenHash }, async () => {
        const tx = getTenantDb();
        const [deletedDraft] = await tx
          .delete(schema.drafts)
          .where(and(eq(schema.drafts.tokenHash, tokenHash), gt(schema.drafts.expiresAt, new Date())))
          .returning();
        if (!deletedDraft) {
          return undefined;
        }

        await tx.insert(schema.projects).values({
          id: projectId,
          orgId,
          name: deletedDraft.name,
          sourceUrl: deletedDraft.sourceUrl,
          config: { ...(deletedDraft.config as ProjectConfig), id: projectId },
          configVersion: deletedDraft.configVersion,
        });
        return deletedDraft;
      });

      if (!claimed) {
        throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found or expired' });
      }
      claimedDraftId = claimed.id;
    } catch (error) {
      await this.storage.delete(projectIconKey(orgId, projectId)).catch(() => {});
      throw error;
    }

    this.storage.delete(draftIconKey(claimedDraftId)).catch((error: unknown) => {
      this.logger.error({ err: error, draftId: claimedDraftId }, 'Failed to delete claimed draft icon');
    });

    return { id: projectId };
  }
}
