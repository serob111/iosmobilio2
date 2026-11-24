import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, getTenantDb, runInWorkerBuildContext, schema, type Db } from '@mobilio/db';
import type { ObjectStorage } from '@mobilio/storage';
import { buildIpaKey, projectIconKey, shellReleaseIpaKey } from '@mobilio/storage';
import {
  AppStoreConnectClient,
  ensureAdHocProfile,
  ensureBundleId,
  listRegisteredDeviceIds,
  withP12FromBase64,
  type AppleEnvCredentials,
} from '@mobilio/apple';
import { repack, validateProjectConfig, type RepackStepTiming } from '@mobilio/repacker';
import { getCachedBaseIpa } from './base-ipa-cache.js';
import { DrizzleProvisioningProfileCache } from './provisioning-profile-cache.js';

export type RepackJobConfig = {
  /** Local disk cache directory for the base.ipa, keyed by its sha256 — see base-ipa-cache.ts. */
  cacheDir: string;
  rcodesign: { binaryPath: string; expectedSha256: string };
  appleEnv: AppleEnvCredentials;
};

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function timed<T>(timings: RepackStepTiming[], step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  return fn().then(
    (value) => {
      timings.push({ step, durationMs: Date.now() - start });
      return value;
    },
    (error) => {
      timings.push({ step, durationMs: Date.now() - start });
      throw error;
    },
  );
}

/** Marks the build 'building' in its own short, independently-committed transaction — see the module doc comment for why this can't share a transaction with the rest of the job. */
async function markBuilding(db: Db, buildId: string): Promise<{ orgId: string; projectId: string }> {
  const result = await runInWorkerBuildContext(db, buildId, async (build) => {
    await getTenantDb()
      .update(schema.builds)
      .set({ status: 'building', startedAt: build.startedAt ?? new Date() })
      .where(eq(schema.builds.id, build.id));
    return { orgId: build.orgId, projectId: build.projectId };
  });
  if (!result) {
    throw new Error(`Build ${buildId} not found`);
  }
  return result;
}

/**
 * Processes one 'adhoc' build end to end: active base.ipa (local-disk-cached) ->
 * ensureBundleId -> ensureAdHocProfile -> repack() -> upload the resulting .ipa -> mark
 * the build 'done' (or 'failed', with whatever timings were captured before the
 * failure). Runs entirely in-process, with direct DB access via runInWorkerBuildContext
 * — never calls back into apps/api over HTTP the way the GitHub Actions runner does.
 *
 * Deliberately does NOT hold one Postgres transaction open across the whole job —
 * found by actually running this end to end against live Postgres/Redis (not by
 * reasoning about the code) that doing so meant a later step's failure rolled back an
 * earlier step's "mark as building" write, so the build row jumped straight from
 * 'queued' to 'failed'/'done' with no visible intermediate state, and separately that a
 * multi-minute external API/signing pipeline has no business holding a transaction open
 * for its entire duration regardless. Every DB touchpoint here (markBuilding, the
 * provisioning-profile cache's own find/save, the final status update) is its own
 * independently-committed runInWorkerBuildContext call.
 *
 * Deliberately does NOT write a manifest.plist anywhere either: the install endpoint
 * (apps/api, upcoming) generates both the manifest and the .ipa's signed download url
 * together, at request time, from build.shortVersion (set below) + the project's
 * current config + a fresh storage.signedUrl() call.
 */
export async function processRepackJob(db: Db, storage: ObjectStorage, buildId: string, config: RepackJobConfig): Promise<void> {
  const timings: RepackStepTiming[] = [];
  const workDir = await mkdtemp(join(tmpdir(), `repack-job-${buildId}-`));

  try {
    const { orgId, projectId } = await markBuilding(db, buildId);

    const [release] = await timed(timings, 'fetchActiveBase', () =>
      // shell_releases has no tenant concept at all (shell_releases_app_access is
      // permissive — USING(true)); a plain, unscoped query is correct here, not a gap.
      db.select().from(schema.shellReleases).where(eq(schema.shellReleases.isActive, true)),
    );
    if (!release) {
      throw new Error('No active shell_releases version is registered');
    }

    const project = await timed(timings, 'fetchProject', async () => {
      const found = await runInWorkerBuildContext(db, buildId, async () => {
        const [row] = await getTenantDb().select().from(schema.projects).where(eq(schema.projects.id, projectId));
        return row;
      });
      if (!found) {
        throw new Error(`Project ${projectId} not found`);
      }
      return found;
    });
    const projectConfig = validateProjectConfig(project.config);

    const [baseIpaPath, iconPng1024] = await Promise.all([
      timed(timings, 'downloadBase', () => getCachedBaseIpa(storage, shellReleaseIpaKey(release.version), release.sha256, { cacheDir: config.cacheDir })),
      timed(timings, 'downloadIcon', async () => streamToBuffer(await storage.getStream(projectIconKey(orgId, projectId)))),
    ]);

    const client = new AppStoreConnectClient({ credentials: config.appleEnv.ascCredentials });

    const bundle = await timed(timings, 'ensureBundleId', () => ensureBundleId(client, projectConfig.bundleId, projectConfig.name));
    const deviceIds = await timed(timings, 'listDevices', () => listRegisteredDeviceIds(client));
    const profileCache = new DrizzleProvisioningProfileCache(db, buildId, projectId);
    const profile = await timed(timings, 'ensureAdHocProfile', () =>
      ensureAdHocProfile(client, {
        bundleIdResourceId: bundle.resourceId,
        bundleIdentifier: projectConfig.bundleId,
        profileName: `${projectConfig.name} Ad Hoc`,
        certificateId: config.appleEnv.distributionCertId,
        deviceIds,
        cache: profileCache,
      }),
    );

    const outputIpaPath = join(workDir, 'output.ipa');
    const repackResult = await withP12FromBase64(config.appleEnv.signingP12Base64, (p12Path) =>
      repack({
        baseIpaPath,
        baseSha256: release.sha256,
        workDir,
        outputIpaPath,
        rawConfig: project.config,
        iconPng1024,
        bundleId: projectConfig.bundleId,
        displayName: projectConfig.name,
        shortVersion: release.version,
        buildNumber: String(Date.now()),
        teamId: config.appleEnv.teamId,
        provisioningProfile: profile.profileContent,
        signing: { p12Path, p12Password: config.appleEnv.signingP12Password },
        rcodesign: config.rcodesign,
      }),
    );
    timings.push(...repackResult.timings);

    const ipaKey = buildIpaKey(orgId, projectId, buildId);
    await timed(timings, 'uploadIpa', () => storage.putStream(ipaKey, createReadStream(repackResult.outputIpaPath), 'application/octet-stream'));

    await runInWorkerBuildContext(db, buildId, (build) =>
      getTenantDb()
        .update(schema.builds)
        .set({ status: 'done', ipaKey, shortVersion: release.version, stepTimings: timings, finishedAt: new Date() })
        .where(eq(schema.builds.id, build.id)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Repack failed for an unknown reason';
    await runInWorkerBuildContext(db, buildId, (build) =>
      getTenantDb()
        .update(schema.builds)
        .set({ status: 'failed', error: message.slice(0, 2000), stepTimings: timings, finishedAt: new Date() })
        .where(eq(schema.builds.id, build.id)),
    ).catch(() => undefined);
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
