import { generateKeyPairSync } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureBundleId } from '../src/bundle-ids';
import { AppStoreConnectClient } from '../src/client';
import { server } from './mocks/server';

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

function makeClient(): AppStoreConnectClient {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  return new AppStoreConnectClient({
    credentials: { issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem },
    baseDelayMs: 1,
    maxDelayMs: 5,
  });
}

const BASE = 'https://api.appstoreconnect.apple.com/v1';

describe('ensureBundleId', () => {
  it('creates a new bundle id and both capabilities when none exist yet', async () => {
    const createdCapabilities: string[] = [];
    server.use(
      http.get(`${BASE}/bundleIds`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('filter[identifier]')).toBe('am.mobilio.t.cafe');
        expect(url.searchParams.get('include')).toBe('bundleIdCapabilities');
        return HttpResponse.json({ data: [] });
      }),
      http.post(`${BASE}/bundleIds`, async ({ request }) => {
        const body = (await request.json()) as { data: { attributes: { identifier: string; name: string; platform: string } } };
        expect(body.data.attributes).toEqual({ identifier: 'am.mobilio.t.cafe', name: 'Cafe Mobilio', platform: 'IOS' });
        return HttpResponse.json({ data: { type: 'bundleIds', id: 'bundle-id-1', attributes: body.data.attributes } }, { status: 201 });
      }),
      http.post(`${BASE}/bundleIdCapabilities`, async ({ request }) => {
        const body = (await request.json()) as { data: { attributes: { capabilityType: string }; relationships: { bundleId: { data: { id: string } } } } };
        createdCapabilities.push(body.data.attributes.capabilityType);
        expect(body.data.relationships.bundleId.data.id).toBe('bundle-id-1');
        return HttpResponse.json({ data: { type: 'bundleIdCapabilities', id: `cap-${body.data.attributes.capabilityType}`, attributes: body.data.attributes } }, { status: 201 });
      }),
    );

    const client = makeClient();
    const result = await ensureBundleId(client, 'am.mobilio.t.cafe', 'Cafe Mobilio');

    expect(result).toEqual({ resourceId: 'bundle-id-1', identifier: 'am.mobilio.t.cafe', created: true });
    expect(createdCapabilities.sort()).toEqual(['ASSOCIATED_DOMAINS', 'PUSH_NOTIFICATIONS']);
  });

  it('reuses an existing bundle id and adds only the missing capability', async () => {
    const createdCapabilities: string[] = [];
    server.use(
      http.get(`${BASE}/bundleIds`, () =>
        HttpResponse.json({
          data: [{ type: 'bundleIds', id: 'bundle-id-2', attributes: { identifier: 'am.mobilio.t.cafe', name: 'Cafe Mobilio', platform: 'IOS' } }],
          included: [{ type: 'bundleIdCapabilities', id: 'cap-push', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } }],
        }),
      ),
      http.post(`${BASE}/bundleIdCapabilities`, async ({ request }) => {
        const body = (await request.json()) as { data: { attributes: { capabilityType: string } } };
        createdCapabilities.push(body.data.attributes.capabilityType);
        return HttpResponse.json({ data: { type: 'bundleIdCapabilities', id: 'cap-new', attributes: body.data.attributes } }, { status: 201 });
      }),
      http.post(`${BASE}/bundleIds`, () => {
        throw new Error('must not create a bundle id that already exists');
      }),
    );

    const client = makeClient();
    const result = await ensureBundleId(client, 'am.mobilio.t.cafe', 'Cafe Mobilio');

    expect(result).toEqual({ resourceId: 'bundle-id-2', identifier: 'am.mobilio.t.cafe', created: false });
    expect(createdCapabilities).toEqual(['ASSOCIATED_DOMAINS']);
  });

  it('adds no capabilities when both are already present', async () => {
    server.use(
      http.get(`${BASE}/bundleIds`, () =>
        HttpResponse.json({
          data: [{ type: 'bundleIds', id: 'bundle-id-3', attributes: { identifier: 'am.mobilio.t.cafe', name: 'Cafe Mobilio', platform: 'IOS' } }],
          included: [
            { type: 'bundleIdCapabilities', id: 'cap-push', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } },
            { type: 'bundleIdCapabilities', id: 'cap-domains', attributes: { capabilityType: 'ASSOCIATED_DOMAINS' } },
          ],
        }),
      ),
      http.post(`${BASE}/bundleIdCapabilities`, () => {
        throw new Error('must not add a capability that already exists');
      }),
    );

    const client = makeClient();
    const result = await ensureBundleId(client, 'am.mobilio.t.cafe', 'Cafe Mobilio');
    expect(result.created).toBe(false);
  });
});
