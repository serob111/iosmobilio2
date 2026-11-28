import type { AppStoreConnectClient } from './client.js';

export type BundleIdCapabilityType = 'PUSH_NOTIFICATIONS' | 'ASSOCIATED_DOMAINS';

/** The two capabilities every Mobilio client app needs — push for notifications, associated domains for universal/deep links. */
const REQUIRED_CAPABILITIES: readonly BundleIdCapabilityType[] = ['PUSH_NOTIFICATIONS', 'ASSOCIATED_DOMAINS'];

type BundleIdResource = {
  type: 'bundleIds';
  id: string;
  attributes: { identifier: string; name: string; platform: 'IOS' | 'MAC_OS' | 'UNIVERSAL' };
};

type BundleIdCapabilityResource = {
  type: 'bundleIdCapabilities';
  id: string;
  attributes: { capabilityType: BundleIdCapabilityType };
};

type BundleIdsListResponse = {
  data: BundleIdResource[];
  included?: BundleIdCapabilityResource[];
};

type BundleIdSingleResponse = {
  data: BundleIdResource;
};

export type EnsureBundleIdResult = {
  /** The App Store Connect resource id (not the identifier string) — needed by later ensureAdHocProfile calls. */
  resourceId: string;
  identifier: string;
  /** false when an existing bundle id was found and reused as-is. */
  created: boolean;
};

/**
 * Looks up a bundle id by its identifier string (am.mobilio.t.<id>), creating it in
 * App Store Connect if it doesn't exist yet, then ensures both PUSH_NOTIFICATIONS and
 * ASSOCIATED_DOMAINS capabilities are enabled on it — adding only whichever of the two
 * is actually missing, never re-adding one that's already there (Apple's own API
 * returns a conflict for a duplicate capability, and there's no reason to call it for
 * a capability ensureBundleId's own lookup already confirmed is present).
 */
export async function ensureBundleId(client: AppStoreConnectClient, bundleId: string, name: string): Promise<EnsureBundleIdResult> {
  const existing = await client.request<BundleIdsListResponse>('GET', 'bundleIds', {
    query: { 'filter[identifier]': bundleId, include: 'bundleIdCapabilities' },
  });

  let resourceId: string;
  let created: boolean;
  let existingCapabilities: Set<BundleIdCapabilityType>;

  const existingBundleId = existing.data[0];
  if (existingBundleId) {
    resourceId = existingBundleId.id;
    created = false;
    existingCapabilities = new Set(
      (existing.included ?? []).filter((resource) => resource.type === 'bundleIdCapabilities').map((resource) => resource.attributes.capabilityType),
    );
  } else {
    const createResponse = await client.request<BundleIdSingleResponse>('POST', 'bundleIds', {
      body: { data: { type: 'bundleIds', attributes: { identifier: bundleId, name, platform: 'IOS' } } },
    });
    resourceId = createResponse.data.id;
    created = true;
    existingCapabilities = new Set();
  }

  for (const capabilityType of REQUIRED_CAPABILITIES) {
    if (existingCapabilities.has(capabilityType)) continue;
    await client.request('POST', 'bundleIdCapabilities', {
      body: {
        data: {
          type: 'bundleIdCapabilities',
          attributes: { capabilityType },
          relationships: { bundleId: { data: { type: 'bundleIds', id: resourceId } } },
        },
      },
    });
  }

  return { resourceId, identifier: bundleId, created };
}
