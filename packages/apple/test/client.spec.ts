import { generateKeyPairSync } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreConnectClient } from '../src/client';
import { AppStoreConnectError } from '../src/errors';
import { server } from './mocks/server';

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

function makeClient(overrides: Partial<ConstructorParameters<typeof AppStoreConnectClient>[0]> = {}): AppStoreConnectClient {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  return new AppStoreConnectClient({
    credentials: { issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem },
    baseUrl: 'https://api.appstoreconnect.apple.com/v1',
    baseDelayMs: 1,
    maxDelayMs: 5,
    ...overrides,
  });
}

describe('AppStoreConnectClient', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('sends a bearer JWT in the Authorization header', async () => {
    let capturedAuth: string | null = null;
    server.use(
      http.get('https://api.appstoreconnect.apple.com/v1/bundleIds', ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        return HttpResponse.json({ data: [] });
      }),
    );

    const client = makeClient();
    await client.request('GET', 'bundleIds');
    expect(capturedAuth).toMatch(/^Bearer ey/);
  });

  it('serializes query params and the request body', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    server.use(
      http.post('https://api.appstoreconnect.apple.com/v1/bundleIds', async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = await request.json();
        return HttpResponse.json({ data: { id: '1' } }, { status: 201 });
      }),
    );

    const client = makeClient();
    const result = await client.request<{ data: { id: string } }>('POST', 'bundleIds', {
      query: { filter: 'am.mobilio.t.cafe', skipMe: undefined },
      body: { name: 'Cafe' },
    });

    expect(capturedUrl).toContain('filter=am.mobilio.t.cafe');
    expect(capturedUrl).not.toContain('skipMe');
    expect(capturedBody).toEqual({ name: 'Cafe' });
    expect(result).toEqual({ data: { id: '1' } });
  });

  it('returns undefined for a 204 response without attempting to parse a body', async () => {
    server.use(http.delete('https://api.appstoreconnect.apple.com/v1/bundleIds/1', () => new HttpResponse(null, { status: 204 })));
    const client = makeClient();
    await expect(client.request('DELETE', 'bundleIds/1')).resolves.toBeUndefined();
  });

  it('throws HTTP_ERROR immediately for a non-retryable 4xx, without retrying', async () => {
    let callCount = 0;
    server.use(
      http.get('https://api.appstoreconnect.apple.com/v1/bundleIds', () => {
        callCount++;
        return HttpResponse.json({ errors: [{ detail: 'not found' }] }, { status: 404 });
      }),
    );

    const client = makeClient();
    await expect(client.request('GET', 'bundleIds')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 404,
      responseBody: { errors: [{ detail: 'not found' }] },
    });
    expect(callCount).toBe(1);
  });

  it('retries a 429, honoring Retry-After, and succeeds on a later attempt', async () => {
    let callCount = 0;
    server.use(
      http.get('https://api.appstoreconnect.apple.com/v1/bundleIds', () => {
        callCount++;
        if (callCount < 3) {
          return new HttpResponse(null, { status: 429, headers: { 'retry-after': '0' } });
        }
        return HttpResponse.json({ data: [] });
      }),
    );

    const client = makeClient({ maxAttempts: 4 });
    const result = await client.request('GET', 'bundleIds');
    expect(callCount).toBe(3);
    expect(result).toEqual({ data: [] });
  });

  it('retries a 5xx up to maxAttempts, then throws the last HTTP_ERROR', async () => {
    let callCount = 0;
    server.use(
      http.get('https://api.appstoreconnect.apple.com/v1/bundleIds', () => {
        callCount++;
        return HttpResponse.json({ errors: [{ detail: 'boom' }] }, { status: 503 });
      }),
    );

    const client = makeClient({ maxAttempts: 3 });
    await expect(client.request('GET', 'bundleIds')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 });
    expect(callCount).toBe(3);
  });

  it('throws INVALID_RESPONSE when a 2xx response body is not valid JSON', async () => {
    server.use(http.get('https://api.appstoreconnect.apple.com/v1/bundleIds', () => new HttpResponse('not json', { status: 200 })));
    const client = makeClient();
    await expect(client.request('GET', 'bundleIds')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reuses the same JWT across requests within its lifetime instead of signing one every call', async () => {
    const authHeaders: string[] = [];
    server.use(
      http.get('https://api.appstoreconnect.apple.com/v1/bundleIds', ({ request }) => {
        authHeaders.push(request.headers.get('authorization')!);
        return HttpResponse.json({ data: [] });
      }),
    );

    const client = makeClient();
    await client.request('GET', 'bundleIds');
    await client.request('GET', 'bundleIds');
    expect(authHeaders[0]).toBe(authHeaders[1]);
  });

  it('wraps a timeout as a TIMEOUT error after the configured per-attempt timeout', async () => {
    server.use(
      http.get('https://api.appstoreconnect.apple.com/v1/bundleIds', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ data: [] });
      }),
    );

    const client = makeClient({ timeoutMs: 5, maxAttempts: 1 });
    await expect(client.request('GET', 'bundleIds')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('wraps a real network/connection failure as NETWORK_ERROR after exhausting retries', async () => {
    const client = makeClient({
      baseUrl: 'https://this-host-has-no-msw-handler.appstoreconnect.apple.com/v1',
      maxAttempts: 2,
    });
    await expect(client.request('GET', 'bundleIds')).rejects.toBeInstanceOf(AppStoreConnectError);
    await expect(client.request('GET', 'bundleIds')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
