import { createHash, generateKeyPairSync } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppStoreConnectClient } from '../src/client';
import { ensureAdHocProfile, type ProvisioningProfileCache, type ProvisioningProfileRecord } from '../src/profiles';
import { server } from './mocks/server';

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const BASE = 'https://api.appstoreconnect.apple.com/v1';

function makeClient(): AppStoreConnectClient {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  return new AppStoreConnectClient({
    credentials: { issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem },
    baseDelayMs: 1,
    maxDelayMs: 5,
  });
}

class FakeProvisioningProfileCache implements ProvisioningProfileCache {
  private record: ProvisioningProfileRecord | undefined;
  saveCalls: ProvisioningProfileRecord[] = [];

  constructor(initial?: ProvisioningProfileRecord) {
    this.record = initial;
  }

  async find(): Promise<ProvisioningProfileRecord | undefined> {
    return this.record;
  }

  async save(_bundleIdentifier: string, record: ProvisioningProfileRecord): Promise<void> {
    this.record = record;
    this.saveCalls.push(record);
  }
}

function mockCreateProfile(profileId: string, expirationDate: string) {
  return http.post(`${BASE}/profiles`, async ({ request }) => {
    const body = (await request.json()) as {
      data: { attributes: { name: string; profileType: string }; relationships: { devices: { data: { id: string }[] } } };
    };
    expect(body.data.attributes.profileType).toBe('IOS_APP_ADHOC');
    return HttpResponse.json(
      {
        data: {
          type: 'profiles',
          id: profileId,
          attributes: { profileContent: Buffer.from('fake mobileprovision bytes').toString('base64'), expirationDate },
        },
      },
      { status: 201 },
    );
  });
}

const FAR_FUTURE = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString();
const WITHIN_7_DAYS = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

describe('ensureAdHocProfile', () => {
  it('creates a new profile and caches it when nothing is cached yet', async () => {
    server.use(mockCreateProfile('profile-1', FAR_FUTURE));
    const cache = new FakeProvisioningProfileCache();
    const client = makeClient();

    const result = await ensureAdHocProfile(client, {
      bundleIdResourceId: 'bundle-1',
      bundleIdentifier: 'am.mobilio.t.cafe',
      profileName: 'Mobilio Cafe Ad Hoc',
      certificateId: 'cert-1',
      deviceIds: ['device-a', 'device-b'],
      cache,
    });

    expect(result.profileId).toBe('profile-1');
    expect(result.profileContent.toString('utf8')).toBe('fake mobileprovision bytes');
    expect(cache.saveCalls).toHaveLength(1);
  });

  it('reuses the cached profile without calling Apple at all when the device set is unchanged and expiry is far off', async () => {
    server.use(
      http.post(`${BASE}/profiles`, () => {
        throw new Error('must not create a profile when a valid one is already cached');
      }),
    );
    const cached: ProvisioningProfileRecord = {
      profileId: 'profile-cached',
      profileContent: Buffer.from('cached bytes'),
      devicesHash: hashOf(['device-a', 'device-b']),
      expiresAt: new Date(FAR_FUTURE),
    };
    const cache = new FakeProvisioningProfileCache(cached);
    const client = makeClient();

    const result = await ensureAdHocProfile(client, {
      bundleIdResourceId: 'bundle-1',
      bundleIdentifier: 'am.mobilio.t.cafe',
      profileName: 'Mobilio Cafe Ad Hoc',
      certificateId: 'cert-1',
      deviceIds: ['device-b', 'device-a'], // different order, same set
      cache,
    });

    expect(result).toBe(cached);
    expect(cache.saveCalls).toHaveLength(0);
  });

  it('creates a replacement and deletes the old profile when the device set changed', async () => {
    let deletedProfileId: string | undefined;
    server.use(
      mockCreateProfile('profile-2', FAR_FUTURE),
      http.delete(`${BASE}/profiles/:id`, ({ params }) => {
        deletedProfileId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const cached: ProvisioningProfileRecord = {
      profileId: 'profile-old',
      profileContent: Buffer.from('old bytes'),
      devicesHash: hashOf(['device-a']),
      expiresAt: new Date(FAR_FUTURE),
    };
    const cache = new FakeProvisioningProfileCache(cached);
    const client = makeClient();

    const result = await ensureAdHocProfile(client, {
      bundleIdResourceId: 'bundle-1',
      bundleIdentifier: 'am.mobilio.t.cafe',
      profileName: 'Mobilio Cafe Ad Hoc',
      certificateId: 'cert-1',
      deviceIds: ['device-a', 'device-b'],
      cache,
    });

    expect(result.profileId).toBe('profile-2');
    expect(deletedProfileId).toBe('profile-old');
  });

  it('creates a replacement when the cached profile is within 7 days of expiring, even with the same device set', async () => {
    server.use(mockCreateProfile('profile-3', FAR_FUTURE), http.delete(`${BASE}/profiles/:id`, () => new HttpResponse(null, { status: 204 })));
    const cached: ProvisioningProfileRecord = {
      profileId: 'profile-expiring-soon',
      profileContent: Buffer.from('old bytes'),
      devicesHash: hashOf(['device-a', 'device-b']),
      expiresAt: new Date(WITHIN_7_DAYS),
    };
    const cache = new FakeProvisioningProfileCache(cached);
    const client = makeClient();

    const result = await ensureAdHocProfile(client, {
      bundleIdResourceId: 'bundle-1',
      bundleIdentifier: 'am.mobilio.t.cafe',
      profileName: 'Mobilio Cafe Ad Hoc',
      certificateId: 'cert-1',
      deviceIds: ['device-a', 'device-b'],
      cache,
    });

    expect(result.profileId).toBe('profile-3');
  });

  it('still returns the newly created profile even when deleting the old one fails', async () => {
    server.use(mockCreateProfile('profile-4', FAR_FUTURE), http.delete(`${BASE}/profiles/:id`, () => new HttpResponse(null, { status: 500 })));
    const cached: ProvisioningProfileRecord = {
      profileId: 'profile-old-2',
      profileContent: Buffer.from('old bytes'),
      devicesHash: hashOf(['device-a']),
      expiresAt: new Date(FAR_FUTURE),
    };
    const cache = new FakeProvisioningProfileCache(cached);
    const client = new AppStoreConnectClient({
      credentials: {
        issuerId: 'issuer-1',
        keyId: 'KEY123',
        privateKeyPem: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'sec1', format: 'pem' }).toString(),
      },
      baseDelayMs: 1,
      maxDelayMs: 2,
      maxAttempts: 1,
    });

    const result = await ensureAdHocProfile(client, {
      bundleIdResourceId: 'bundle-1',
      bundleIdentifier: 'am.mobilio.t.cafe',
      profileName: 'Mobilio Cafe Ad Hoc',
      certificateId: 'cert-1',
      deviceIds: ['device-a', 'device-b'],
      cache,
    });

    expect(result.profileId).toBe('profile-4');
    expect(cache.saveCalls).toHaveLength(1);
  });
});

function hashOf(deviceIds: string[]): string {
  return createHash('sha256').update([...deviceIds].sort().join(',')).digest('hex');
}
