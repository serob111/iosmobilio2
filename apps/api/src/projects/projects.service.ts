import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { runInTenantContext, getTenantDb, schema, eq } from '@mobilio/db';
import {
  CONFIG_SCHEMA_VERSION,
  deriveBundleId,
  parseProjectConfig,
  slugify,
  type ProjectConfig,
  type ProjectConfigInput,
} from '@mobilio/config';
import { type ObjectStorage, projectIconKey } from '@mobilio/storage';
import { uuidv7 } from 'uuidv7';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { analyzeSite, AnalyzeSiteError } from './analyze-site.js';
import { processIconImage } from './icon.js';

export type ProjectSummary = {
  id: string;
  name: string;
  sourceUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dbService: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** POST /orgs/:orgId/projects — analyzes the given site and creates a project from it. */
  async createProject(orgId: string, userId: string, url: string): Promise<{ id: string }> {
    let analysis;
    try {
      analysis = await analyzeSite(url);
    } catch (error) {
      // AnalyzeSiteError.code is stable and machine-readable (UNSAFE_URL, NOT_HTML, ...)
      // — apps/web is meant to translate by code once it has real i18n, not this
      // (English, not localized) message text.
      if (error instanceof AnalyzeSiteError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw new BadRequestException({
        code: 'SITE_UNREACHABLE',
        message: 'Could not load the site',
      });
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
      // output plus constants, so a failure here means a bug in how this method
      // assembles the config, not bad user input.
      throw new InternalServerErrorException({
        code: 'INTERNAL_ERROR',
        message: `Не удалось собрать конфигурацию: ${parsed.errors.join('; ')}`,
      });
    }

    await runInTenantContext(this.dbService.db, { orgId, userId }, () =>
      getTenantDb().insert(schema.projects).values({
        id,
        orgId,
        name: parsed.data.name,
        sourceUrl: analysis.url,
        config: parsed.data,
        configVersion: CONFIG_SCHEMA_VERSION,
      }),
    );

    await this.storage.put(projectIconKey(orgId, id), analysis.iconBuffer, 'image/png');

    return { id };
  }

  /** GET /orgs/:orgId/projects — a lightweight list, not the full config per project. */
  async listProjects(orgId: string, userId: string): Promise<ProjectSummary[]> {
    return runInTenantContext(this.dbService.db, { orgId, userId }, () =>
      getTenantDb()
        .select({
          id: schema.projects.id,
          name: schema.projects.name,
          sourceUrl: schema.projects.sourceUrl,
          createdAt: schema.projects.createdAt,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects),
    );
  }

  /**
   * PUT /orgs/:orgId/projects/:projectId — full config replace, same contract as the
   * file-storage version this replaces: the whole ProjectConfig is validated and
   * written, not merged field-by-field. id/bundleId/trial are server-owned, though —
   * always taken from the existing row, never from the request body, so a caller can't
   * quietly change a project's identity or trial flag via an otherwise-ordinary edit.
   */
  async updateProject(
    orgId: string,
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<ProjectConfig> {
    const parsed = parseProjectConfig(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: parsed.errors.join('; '),
      });
    }

    return runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const tx = getTenantDb();
      const [existing] = await tx.select().from(schema.projects).where(eq(schema.projects.id, projectId));
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
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
        .update(schema.projects)
        .set({
          name: finalConfig.name,
          config: finalConfig,
          configVersion: CONFIG_SCHEMA_VERSION,
          // Only a 'url' source carries a URL — an 'html' source leaves the existing
          // column value as-is rather than writing something meaningless over it.
          ...(source.type === 'url' ? { sourceUrl: source.url } : {}),
        })
        .where(eq(schema.projects.id, projectId));

      return finalConfig;
    });
  }

  /** POST /orgs/:orgId/projects/:projectId/icon — multipart upload, same sharp pipeline as site analysis. */
  async uploadIcon(
    orgId: string,
    projectId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<void> {
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
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Не удалось обработать изображение',
      });
    }

    await this.storage.put(projectIconKey(orgId, projectId), iconBuffer, 'image/png');
  }

  /** GET /orgs/:orgId/projects/:projectId/icon — a short-lived signed url, not proxied bytes. */
  async getIconUrl(orgId: string, projectId: string): Promise<string> {
    return this.storage.signedUrl(projectIconKey(orgId, projectId), 300, 'icon.png');
  }
}
