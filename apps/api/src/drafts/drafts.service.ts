import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { runInTokenLookupContext, runInClaimContext, getTenantDb, schema, eq } from '@mobilio/db';
import {
  CONFIG_SCHEMA_VERSION,
  deriveBundleId,
  parseProjectConfig,
  slugify,
  type ProjectConfig,
  type ProjectConfigInput,
} from '@mobilio/config';
import { type ObjectStorage, draftIconKey, projectIconKey } from '@mobilio/storage';
import { uuidv7 } from 'uuidv7';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { analyzeSite, AnalyzeSiteError } from '../projects/analyze-site.js';
import { processIconImage } from '../projects/icon.js';
import { generateDraftToken, hashDraftToken } from './draft-token.js';

@Injectable()
export class DraftsService {
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

    await this.storage.put(draftIconKey(id), analysis.iconBuffer, 'image/png');

    return { rawToken };
  }

  /** PUT /drafts/me — same full-config-replace contract as ProjectsService.updateProject. */
  async updateDraft(tokenHash: string, draftId: string, body: unknown): Promise<ProjectConfig> {
    const parsed = parseProjectConfig(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: parsed.errors.join('; ') });
    }
    if (parsed.data.id !== draftId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Идентификатор черновика не совпадает',
      });
    }

    const source = parsed.data.source;
    await runInTokenLookupContext(this.dbService.db, tokenHash, () =>
      getTenantDb()
        .update(schema.drafts)
        .set({
          name: parsed.data.name,
          config: parsed.data,
          configVersion: CONFIG_SCHEMA_VERSION,
          ...(source.type === 'url' ? { sourceUrl: source.url } : {}),
        })
        .where(eq(schema.drafts.id, draftId)),
    );

    return parsed.data;
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
   * POST /orgs/:orgId/drafts/claim — moves a draft into the org as a new project, in one
   * transaction (runInClaimContext sets app.org_id/app.user_id/app.lookup_token_hash
   * together so the projects insert and the drafts delete commit or roll back as a unit).
   * ObjectStorage has no move/copy primitive, so the icon is relocated via get+put+delete.
   */
  async claimDraft(orgId: string, userId: string, rawToken: string): Promise<{ id: string }> {
    const tokenHash = hashDraftToken(rawToken);
    const projectId = uuidv7();

    const draft = await runInClaimContext(this.dbService.db, { orgId, userId, tokenHash }, async () => {
      const tx = getTenantDb();
      const [row] = await tx.select().from(schema.drafts).where(eq(schema.drafts.tokenHash, tokenHash));
      if (!row || row.expiresAt < new Date()) {
        return undefined;
      }

      await tx.insert(schema.projects).values({
        id: projectId,
        orgId,
        name: row.name,
        sourceUrl: row.sourceUrl,
        config: { ...(row.config as ProjectConfig), id: projectId },
        configVersion: row.configVersion,
      });
      await tx.delete(schema.drafts).where(eq(schema.drafts.id, row.id));
      return row;
    });

    if (!draft) {
      throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found or expired' });
    }

    const iconBuffer = await this.storage.get(draftIconKey(draft.id));
    await this.storage.put(projectIconKey(orgId, projectId), iconBuffer, 'image/png');
    await this.storage.delete(draftIconKey(draft.id));

    return { id: projectId };
  }
}
