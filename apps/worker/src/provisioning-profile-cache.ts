import { getTenantDb, schema, eq, and } from '@mobilio/db';
import type { ProvisioningProfileCache, ProvisioningProfileRecord } from '@mobilio/apple';
import { decryptProvisioningProfile, encryptProvisioningProfile } from './provisioning-profile-crypto.js';

/**
 * Drizzle-backed implementation of @mobilio/apple's ProvisioningProfileCache — that
 * package has no dependency on @mobilio/db (nor should it, see its own doc comment),
 * so the real persistence lives here, in the one place that actually calls
 * ensureAdHocProfile. Must only ever be used from inside a transaction that's already
 * called runInWorkerBuildContext (packages/db) — find/save both go through
 * getTenantDb(), which throws outside any tenant context, and provisioning_profiles'
 * own RLS policy only grants access once app.worker_build_project_id is set.
 */
export class DrizzleProvisioningProfileCache implements ProvisioningProfileCache {
  constructor(
    private readonly orgId: string,
    private readonly projectId: string,
  ) {}

  async find(bundleIdentifier: string): Promise<ProvisioningProfileRecord | undefined> {
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
  }

  async save(bundleIdentifier: string, record: ProvisioningProfileRecord): Promise<void> {
    const profileContentEnc = encryptProvisioningProfile(record.profileContent);
    await getTenantDb()
      .insert(schema.provisioningProfiles)
      .values({
        orgId: this.orgId,
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
  }
}
