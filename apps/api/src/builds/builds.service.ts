import type { Readable } from 'node:stream';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { runInTenantContext, runInBuildContext, getTenantDb, schema, eq, and, desc } from '@mobilio/db';
import type { ProjectConfig } from '@mobilio/config';
import { type ObjectStorage, buildIpaKey, projectIconKey } from '@mobilio/storage';
import { uuidv7 } from 'uuidv7';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { BUILD_RUNNER, type BuildRunner } from './build-runner.js';
import { generateBuildToken } from './build-token.js';
import { createIpaValidationStream, IpaValidationError } from './ipa-stream.js';

/**
 * Opaque identifier for which version of the apps/shell build template a build ran
 * against — not tied to GitHub in any way, just a value recorded on the row and handed
 * back via getBuildConfig so a future (non-GitHub) runner has the same information.
 */
const BUILD_TEMPLATE_VERSION = '1';

const RUNNING_STATUSES = ['queued', 'building'] as const;

function isActiveBuildConflict(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;
  return cause?.code === '23505' && cause?.constraint === 'builds_one_active_per_project';
}

export type BuildSummary = {
  id: string;
  status: string;
  runId: number | null;
  runUrl: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class BuildsService {
  constructor(
    private readonly dbService: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(BUILD_RUNNER) private readonly buildRunner: BuildRunner,
  ) {}

  // ---------------------------------------------------------------------------------
  // User-facing (session + OrgGuard + ProjectGuard)
  // ---------------------------------------------------------------------------------

  /**
   * POST /orgs/:orgId/projects/:projectId/builds — the partial unique index
   * (builds_one_active_per_project) is the real guarantee against a concurrent double
   * dispatch; this doesn't pre-check "is one already running" itself, it just inserts
   * and catches the resulting unique-violation if it loses that race.
   */
  async createBuild(orgId: string, userId: string, projectId: string, apiPublicUrl: string): Promise<{ id: string; status: 'queued' }> {
    const { rawToken, tokenHash, expiresAt } = generateBuildToken();
    const buildId = uuidv7();

    try {
      await runInTenantContext(this.dbService.db, { orgId, userId }, () =>
        getTenantDb().insert(schema.builds).values({
          id: buildId,
          orgId,
          projectId,
          status: 'queued',
          tokenHash,
          tokenExpiresAt: expiresAt,
          templateVersion: BUILD_TEMPLATE_VERSION,
        }),
      );
    } catch (error) {
      if (isActiveBuildConflict(error)) {
        throw new ConflictException({
          code: 'BUILD_IN_PROGRESS',
          message: 'A build is already in progress for this project',
        });
      }
      throw error;
    }

    try {
      await this.buildRunner.dispatch({ id: buildId, token: rawToken, baseUrl: apiPublicUrl });
    } catch (error) {
      await runInTenantContext(this.dbService.db, { orgId, userId }, () =>
        getTenantDb()
          .update(schema.builds)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Failed to dispatch build',
            tokenHash: null,
            tokenExpiresAt: null,
            finishedAt: new Date(),
          })
          .where(eq(schema.builds.id, buildId)),
      );
      throw new BadGatewayException({ code: 'BUILD_DISPATCH_FAILED', message: 'Failed to start the build' });
    }

    return { id: buildId, status: 'queued' };
  }

  /** GET /orgs/:orgId/projects/:projectId/builds — the 20 most recent, newest first. */
  async listBuilds(orgId: string, userId: string, projectId: string): Promise<BuildSummary[]> {
    return runInTenantContext(this.dbService.db, { orgId, userId }, () =>
      getTenantDb()
        .select({
          id: schema.builds.id,
          status: schema.builds.status,
          runId: schema.builds.runId,
          runUrl: schema.builds.runUrl,
          error: schema.builds.error,
          startedAt: schema.builds.startedAt,
          finishedAt: schema.builds.finishedAt,
          createdAt: schema.builds.createdAt,
        })
        .from(schema.builds)
        .where(eq(schema.builds.projectId, projectId))
        .orderBy(desc(schema.builds.createdAt))
        .limit(20),
    );
  }

  /** GET /orgs/:orgId/projects/:projectId/builds/:buildId */
  async getBuild(orgId: string, userId: string, projectId: string, buildId: string): Promise<BuildSummary> {
    const build = await runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const [row] = await getTenantDb()
        .select()
        .from(schema.builds)
        .where(and(eq(schema.builds.id, buildId), eq(schema.builds.projectId, projectId)));
      return row;
    });
    if (!build) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Build not found' });
    }
    return build;
  }

  /**
   * GET /orgs/:orgId/projects/:projectId/builds/:buildId/ipa — 302 only once the build is
   * done. Deliberately queries the full row (not getBuild's narrowed BuildSummary) to get
   * at ipaKey directly: since uploadIpa now writes every attempt under its own per-attempt
   * key (see uploadIpa's comment), the real object key is whatever ipaKey the winning
   * attempt recorded, not a key recomputed from orgId/projectId/buildId alone.
   */
  async getIpaUrl(orgId: string, userId: string, projectId: string, buildId: string): Promise<string> {
    const build = await runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const [row] = await getTenantDb()
        .select()
        .from(schema.builds)
        .where(and(eq(schema.builds.id, buildId), eq(schema.builds.projectId, projectId)));
      return row;
    });
    if (!build) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Build not found' });
    }
    if (build.status !== 'done' || !build.ipaKey) {
      throw new NotFoundException({ code: 'IPA_NOT_READY', message: 'No .ipa available for this build yet' });
    }

    const project = await runInTenantContext(this.dbService.db, { orgId, userId }, async () => {
      const [row] = await getTenantDb().select().from(schema.projects).where(eq(schema.projects.id, projectId));
      return row;
    });
    const slug = (project?.config as ProjectConfig | undefined)?.slug ?? 'app';

    return this.storage.signedUrl(build.ipaKey, 300, `${slug}.ipa`);
  }

  // ---------------------------------------------------------------------------------
  // Runner-facing (BuildRunnerGuard — token auth, no session)
  // ---------------------------------------------------------------------------------

  /** POST /builds/:id/start — queued -> building. Idempotent: calling it again while already building just re-records runId/runUrl. */
  async startBuild(tokenHash: string, runId: number, runUrl: string): Promise<{ status: string }> {
    const updated = await runInBuildContext(this.dbService.db, tokenHash, async (build) => {
      if (!RUNNING_STATUSES.includes(build.status as (typeof RUNNING_STATUSES)[number])) {
        throw new ConflictException({ code: 'INVALID_BUILD_STATE', message: `Cannot start from status ${build.status}` });
      }
      const [row] = await getTenantDb()
        .update(schema.builds)
        .set({ status: 'building', runId, runUrl, startedAt: build.startedAt ?? new Date() })
        .where(eq(schema.builds.id, build.id))
        .returning();
      return row;
    });
    if (!updated) {
      throw new NotFoundException({ code: 'BUILD_NOT_FOUND', message: 'Build not found' });
    }
    return { status: updated.status };
  }

  /** GET /builds/:id/config */
  async getBuildConfig(tokenHash: string): Promise<{ config: ProjectConfig; templateVersion: string | null }> {
    const result = await runInBuildContext(this.dbService.db, tokenHash, async (build) => {
      const [project] = await getTenantDb().select().from(schema.projects).where(eq(schema.projects.id, build.projectId));
      return { config: project!.config as ProjectConfig, templateVersion: build.templateVersion };
    });
    if (!result) {
      throw new NotFoundException({ code: 'BUILD_NOT_FOUND', message: 'Build not found' });
    }
    return result;
  }

  /** GET /builds/:id/icon — streamed PNG. orgId/projectId already live on the build row, so no extra query is needed. */
  async getIconStream(tokenHash: string): Promise<Readable> {
    const build = await runInBuildContext(this.dbService.db, tokenHash, async (row) => row);
    if (!build) {
      throw new NotFoundException({ code: 'BUILD_NOT_FOUND', message: 'Build not found' });
    }
    return this.storage.getStream(projectIconKey(build.orgId, build.projectId));
  }

  /**
   * POST /builds/:id/ipa — only from status 'building'; streams straight through to
   * storage. Each attempt gets its own object key (a retried runner call, or two
   * concurrent requests somehow racing) — sharing one static key would let whichever
   * attempt finishes storage.putStream LAST silently overwrite the other's bytes, even
   * after the loser's own finalize below correctly loses the DB race. Only the attempt
   * that wins the DB update gets its key recorded on the build; the loser's cleanup
   * deletes exactly its own key, never the winner's.
   */
  async uploadIpa(tokenHash: string, currentBuild: { id: string; orgId: string; projectId: string; status: string }, body: Readable): Promise<void> {
    if (currentBuild.status !== 'building') {
      throw new ConflictException({
        code: 'INVALID_BUILD_STATE',
        message: `Cannot upload an .ipa from status ${currentBuild.status}`,
      });
    }

    const key = `${buildIpaKey(currentBuild.orgId, currentBuild.projectId, currentBuild.id)}-${uuidv7()}`;
    const validated = body.pipe(createIpaValidationStream());
    try {
      await this.storage.putStream(key, validated, 'application/octet-stream');
    } catch (error) {
      if (error instanceof IpaValidationError) {
        throw error.code === 'IPA_TOO_LARGE'
          ? new PayloadTooLargeException(error.message)
          : new BadRequestException({ code: 'INVALID_IPA', message: error.message });
      }
      throw error;
    }

    const updated = await runInBuildContext(this.dbService.db, tokenHash, async (build) => {
      if (build.status !== 'building') {
        return undefined;
      }
      // status = 'building' belongs in the WHERE clause itself, not just the early
      // check above: two concurrent finalizes can both pass that check against their
      // own pre-commit snapshot, then one blocks on the other's row lock. Once
      // unblocked, Postgres re-evaluates this WHERE against the now-committed row
      // before proceeding (EvalPlanQual) — without this condition here, the second
      // attempt would still match on id alone and overwrite the first attempt's ipaKey,
      // and both would report success. With it, the second attempt's WHERE no longer
      // matches (status is already 'done'), so it updates 0 rows and correctly loses.
      const [row] = await getTenantDb()
        .update(schema.builds)
        .set({ status: 'done', ipaKey: key, finishedAt: new Date(), tokenHash: null, tokenExpiresAt: null })
        .where(and(eq(schema.builds.id, build.id), eq(schema.builds.status, 'building')))
        .returning();
      return row;
    });

    if (!updated) {
      await this.storage.delete(key).catch(() => {});
      throw new ConflictException({ code: 'INVALID_BUILD_STATE', message: 'Build is no longer building' });
    }
  }

  /** POST /builds/:id/fail — from queued or building. */
  async failBuild(tokenHash: string, errorText: string): Promise<void> {
    const truncated = errorText.slice(0, 2000);
    const updated = await runInBuildContext(this.dbService.db, tokenHash, async (build) => {
      if (!RUNNING_STATUSES.includes(build.status as (typeof RUNNING_STATUSES)[number])) {
        throw new ConflictException({ code: 'INVALID_BUILD_STATE', message: `Cannot fail from status ${build.status}` });
      }
      const [row] = await getTenantDb()
        .update(schema.builds)
        .set({ status: 'failed', error: truncated, finishedAt: new Date(), tokenHash: null, tokenExpiresAt: null })
        .where(eq(schema.builds.id, build.id))
        .returning();
      return row;
    });
    if (!updated) {
      throw new NotFoundException({ code: 'BUILD_NOT_FOUND', message: 'Build not found' });
    }
  }
}
