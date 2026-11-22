import { generateKeyPairSync } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppStoreConnectClient } from '../src/client';
import { listRegisteredDeviceIds } from '../src/devices';
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

describe('listRegisteredDeviceIds', () => {
  it('returns every ENABLED device id from a single page', async () => {
    server.use(
      http.get(`${BASE}/devices`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('filter[status]')).toBe('ENABLED');
        return HttpResponse.json({
          data: [
            { type: 'devices', id: 'device-1', attributes: { status: 'ENABLED' } },
            { type: 'devices', id: 'device-2', attributes: { status: 'ENABLED' } },
          ],
        });
      }),
    );

    const client = makeClient();
    const ids = await listRegisteredDeviceIds(client);
    expect(ids).toEqual(['device-1', 'device-2']);
  });

  it('follows links.next to collect every page', async () => {
    server.use(
      http.get(`${BASE}/devices`, ({ request }) => {
        if (request.url.includes('cursor=page2')) {
          return HttpResponse.json({ data: [{ type: 'devices', id: 'device-2', attributes: { status: 'ENABLED' } }] });
        }
        return HttpResponse.json({
          data: [{ type: 'devices', id: 'device-1', attributes: { status: 'ENABLED' } }],
          links: { next: `${BASE}/devices?cursor=page2` },
        });
      }),
    );

    const client = makeClient();
    const ids = await listRegisteredDeviceIds(client);
    expect(ids).toEqual(['device-1', 'device-2']);
  });

  it('returns an empty array when the account has no enabled devices', async () => {
    server.use(http.get(`${BASE}/devices`, () => HttpResponse.json({ data: [] })));
    const client = makeClient();
    expect(await listRegisteredDeviceIds(client)).toEqual([]);
  });
});
