import { createHash } from 'node:crypto';
import type { AppStoreConnectClient } from './client.js';

const AD_HOC_PROFILE_TYPE = 'IOS_APP_ADHOC';
/** Apple's own documented reuse window: don't wait until a profile is already expired to replace it. */
const REUSE_EXPIRY_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

type ProfileResource = {
  type: 'profiles';
  id: string;
  attributes: {
    profileContent: string; // base64-encoded .mobileprovision bytes
    expirationDate: string; // ISO 8601
  };
};

type ProfileSingleResponse = { data: ProfileResource };

export type ProvisioningProfileRecord = {
  /** Apple's own resource id for this profile — needed to DELETE it later. */
  profileId: string;
  /** Raw .mobileprovision bytes (a signed PKCS#7 blob) — handed to packages/repacker's embedProvisioningProfile as-is. */
  profileContent: Buffer;
  devicesHash: string;
  expiresAt: Date;
};

/**
 * Caller-supplied persistence for the one Ad Hoc profile per bundle id — deliberately
 * an interface, not a concrete DB client: packages/apple has no dependency on
 * packages/db (nor should it; no other packages/* package depends on packages/db
 * either), so the real Drizzle/Postgres-backed implementation lives wherever this is
 * actually called from (apps/worker).
 */
export interface ProvisioningProfileCache {
  find(bundleIdentifier: string): Promise<ProvisioningProfileRecord | undefined>;
  save(bundleIdentifier: string, record: ProvisioningProfileRecord): Promise<void>;
}

export type EnsureAdHocProfileOptions = {
  /** The bundleIds resource id (not the identifier string) — from ensureBundleId's own result. */
  bundleIdResourceId: string;
  /** The identifier string (am.mobilio.t.<id>) — used as the cache's lookup key. */
  bundleIdentifier: string;
  profileName: string;
  certificateId: string;
  deviceIds: string[];
  cache: ProvisioningProfileCache;
  now?: Date;
};

function hashDeviceIds(deviceIds: readonly string[]): string {
  return createHash('sha256').update([...deviceIds].sort().join(',')).digest('hex');
}

async function createProfile(
  client: AppStoreConnectClient,
  options: { bundleIdResourceId: string; profileName: string; certificateId: string; deviceIds: string[] },
): Promise<ProvisioningProfileRecord> {
  const response = await client.request<ProfileSingleResponse>('POST', 'profiles', {
    body: {
      data: {
        type: 'profiles',
        attributes: { name: options.profileName, profileType: AD_HOC_PROFILE_TYPE },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: options.bundleIdResourceId } },
          certificates: { data: [{ type: 'certificates', id: options.certificateId }] },
          devices: { data: options.deviceIds.map((id) => ({ type: 'devices', id })) },
        },
      },
    },
  });
  return {
    profileId: response.data.id,
    profileContent: Buffer.from(response.data.attributes.profileContent, 'base64'),
    devicesHash: hashDeviceIds(options.deviceIds),
    expiresAt: new Date(response.data.attributes.expirationDate),
  };
}

/** Apple's profiles are immutable (create/delete only, no PATCH of devices) — removing an old one is a distinct call, always after its replacement already exists and is cached. */
async function deleteProfile(client: AppStoreConnectClient, profileId: string): Promise<void> {
  await client.request('DELETE', `profiles/${profileId}`);
}

/**
 * Finds-or-creates the one Ad Hoc provisioning profile for a bundle id, reusing the
 * cached one as long as the device set hasn't changed and it isn't within 7 days of
 * expiring — the common case, and the one that avoids calling Apple's own
 * (rate-limited) API at all. Otherwise mints a fresh profile, saves it to the cache
 * (so later calls see it), and only then deletes whatever profile it's replacing —
 * in that order, so a delete failure never leaves the cache pointing at a profile that
 * no longer exists on Apple's side, and a save failure never leaves the old profile
 * deleted while the new one was never actually persisted.
 */
export async function ensureAdHocProfile(client: AppStoreConnectClient, options: EnsureAdHocProfileOptions): Promise<ProvisioningProfileRecord> {
  const now = options.now ?? new Date();
  const devicesHash = hashDeviceIds(options.deviceIds);
  const cached = await options.cache.find(options.bundleIdentifier);

  if (cached && cached.devicesHash === devicesHash && cached.expiresAt.getTime() - now.getTime() > REUSE_EXPIRY_MARGIN_MS) {
    return cached;
  }

  const created = await createProfile(client, {
    bundleIdResourceId: options.bundleIdResourceId,
    profileName: options.profileName,
    certificateId: options.certificateId,
    deviceIds: options.deviceIds,
  });
  await options.cache.save(options.bundleIdentifier, created);

  // Best-effort: the new profile is already valid and already cached by this point, so
  // a delete failure here must not fail the whole call — that would make the caller
  // retry, and a retry re-enters this same "no usable cached profile" path and mints
  // *yet another* profile at Apple, compounding exactly the leak this cleanup step was
  // trying to avoid. A profile that fails to delete just sits unused at Apple until
  // some future manual/administrative cleanup; that's a minor annoyance, not a
  // correctness problem for this build.
  if (cached) {
    await deleteProfile(client, cached.profileId).catch(() => undefined);
  }

  return created;
}
