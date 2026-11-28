import { getTenantDb, runInWorkerBuildContext, schema, eq, and, type Db } from '@mobilio/db';
import type { ProvisioningProfileCache, ProvisioningProfileRecord } from '@mobilio/apple';
import { decryptProvisioningProfile, encryptProvisioningProfile } from './provisioning-profile-crypto.js';

/**
 * Drizzle-backed implementation of @mobilio/apple's ProvisioningProfileCache — that
 * package has no dependency on @mobilio/db (nor should it, see its own doc comment),
 * so the real persistence lives here, in the one place that actually calls
 * ensureAdHocProfile.
 *
 * Opens its own short-lived runInWorkerBuildContext transaction on every find()/save()
 * call, rather than relying on an already-open ambient context from its caller — the
 * repack job around it does real external I/O (ASC API calls, downloading/signing a
 * multi-hundred-MB .ipa) that can run for minutes, and a single Postgres transaction
 * held open across all of that would be true even if nothing ever failed. Worse: an
 * earlier version of this design wrapped the *entire* job in one transaction, which
 * meant a failure in a *later* step rolled back a DB write (marking the build
 * "building") made in an *earlier* step — found by actually running the worker end to
 * end against live Postgres/Redis, not by reasoning about the code. Each call here is
 * its own independently-committed unit of work.
 */
export class DrizzleProvisioningProfileCache implements ProvisioningProfileCache {
  constructor(
    private readonly db: Db,
    private readonly buildId: string,
    private readonly projectId: string,
  ) {}

  async find(bundleIdentifier: string): Promise<ProvisioningProfileRecord | undefined> {
    return runInWorkerBuildContext(this.db, this.buildId, async () => {
      const [row] = await getTenantDb()
        .select()
        .from(schema.provisioningProfiles)
        .where(and(eq(schema.provisioningProfiles.projectId, this.projectId), eq(schema.provisioningProfiles.bundleId, bundleIdentifier)));
      if (!row) return undefined;
      return {
        profileId: row.profileId,
        profileContent: decryptProvisioningProfile(row.profileContentEnc),
        devicesHash: row.devicesHash,
        expiresAt: row.expiresAt,
      };
    });
  }

  async save(bundleIdentifier: string, record: ProvisioningProfileRecord): Promise<void> {
    const profileContentEnc = encryptProvisioningProfile(record.profileContent);
    await runInWorkerBuildContext(this.db, this.buildId, async (build) => {
      await getTenantDb()
        .insert(schema.provisioningProfiles)
        .values({
          orgId: build.orgId,
          projectId: this.projectId,
          bundleId: bundleIdentifier,
          devicesHash: record.devicesHash,
          profileId: record.profileId,
          profileContentEnc,
          expiresAt: record.expiresAt,
        })
        .onConflictDoUpdate({
          target: [schema.provisioningProfiles.projectId, schema.provisioningProfiles.bundleId],
          set: {
            devicesHash: record.devicesHash,
            profileId: record.profileId,
            profileContentEnc,
            expiresAt: record.expiresAt,
            updatedAt: new Date(),
          },
        });
    });
  }
}
