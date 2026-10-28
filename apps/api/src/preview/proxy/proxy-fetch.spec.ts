import { describe, expect, it, vi, beforeEach } from 'vitest';

const { lookupMock, fetchMock, agentCloseMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  fetchMock: vi.fn(),
  agentCloseMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

// Same reasoning as net/safe-fetch.spec.ts — fetch via vi.stubGlobal (so the live-lookup
// pattern in proxy-fetch.ts picks it up), Agent mocked down to just a spyable close().
vi.mock('undici', () => ({
  Agent: class {
    close = agentCloseMock;
  },
}));
vi.stubGlobal('fetch', fetchMock);

const { proxyFetch, ProxyFetchError } = await import('./proxy-fetch.js');

function webBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

function fakeResponse(opts: { status: number; headers?: Record<string, string>; body?: string[] }): unknown {
  const headerMap = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status: opts.status,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    body: webBody(opts.body ?? []),
  };
}

function fakeRedirectResponse(location: string): unknown {
  const cancel = vi.fn().mockResolvedValue(undefined);
  return {
    status: 302,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
    body: { cancel },
  };
}

async function readAll(readable: NodeJS.ReadableStream): Promise<{ text: string; error?: Error }> {
  const chunks: Buffer[] = [];
  return new Promise((resolve) => {
    readable.on('data', (chunk: Buffer) => chunks.push(chunk));
    readable.on('end', () => resolve({ text: Buffer.concat(chunks).toString() }));
    readable.on('error', (error: Error) => resolve({ text: Buffer.concat(chunks).toString(), error }));
  });
}

const ALLOWLIST = { baseHost: 'example.com' };

describe('proxyFetch', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    fetchMock.mockReset();
    agentCloseMock.mockClear();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('rejects a host outside the allowlist on the first hop without making any request', async () => {
    await expect(
      proxyFetch('https://evil.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects userinfo in the url without making any request', async () => {
    await expect(
      proxyFetch('https://user:pass@example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-standard port without making any request', async () => {
    await expect(
      proxyFetch('https://example.com:8443/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a disallowed scheme without making any request', async () => {
    await expect(
      proxyFetch('ftp://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a subdomain of the allowlist base host', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: ['hi'] }));
    const outcome = await proxyFetch('https://cdn.example.com/a.png', {
      method: 'GET',
      allowlist: ALLOWLIST,
      maxBodyBytes: 1000,
    });
    expect(outcome.kind).toBe('ok');
  });

  it('streams the response status/body for a plain 200 response', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, headers: { 'content-type': 'text/html' }, body: ['hi'] }));
    const outcome = await proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.status).toBe(200);
    const { text } = await readAll(outcome.result.body);
    expect(text).toBe('hi');
  });

  it('passes the method through to the underlying fetch call (HEAD)', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: [] }));
    await proxyFetch('https://example.com/', { method: 'HEAD', allowlist: ALLOWLIST, maxBodyBytes: 1000 });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' });
  });

  it('follows a redirect to a host within the allowlist', async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    fetchMock
      .mockResolvedValueOnce(fakeRedirectResponse('https://cdn.example.com/next'))
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: ['final'] }));

    const outcome = await proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const { text } = await readAll(outcome.result.body);
    expect(text).toBe('final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT follow a redirect to a host outside the allowlist — returns external-redirect instead of an error', async () => {
    fetchMock.mockResolvedValueOnce(fakeRedirectResponse('https://checkout.stripe.com/session/abc'));

    const outcome = await proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 });
    expect(outcome).toEqual({ kind: 'external-redirect', location: 'https://checkout.stripe.com/session/abc' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels the redirect response body before deciding whether to follow it', async () => {
    const redirect = fakeRedirectResponse('https://evil.com/');
    fetchMock.mockResolvedValueOnce(redirect);

    await proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 });

    expect((redirect as { body: { cancel: ReturnType<typeof vi.fn> } }).body.cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect within the allowlist by hostname but resolving to a forbidden IP (defense in depth)', async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    fetchMock.mockResolvedValueOnce(fakeRedirectResponse('https://cdn.example.com/'));

    await expect(
      proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('caps the number of allowed-host redirects at the configured maximum', async () => {
    fetchMock.mockResolvedValue(fakeRedirectResponse('https://cdn.example.com/next'));
    await expect(
      proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000, maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('destroys the stream with RESPONSE_TOO_LARGE once the body exceeds maxBodyBytes, while still streaming', async () => {
    const big = 'x'.repeat(600);
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: [big] }));
    const outcome = await proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 500 });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const { error } = await readAll(outcome.result.body);
    expect(error?.message).toMatch(/exceeds 500 bytes/);
  });

  it('rejects a disallowed content-type without the caller needing its own check', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, headers: { 'content-type': 'application/json' }, body: ['{}'] }));
    await expect(
      proxyFetch('https://example.com/', {
        method: 'GET',
        allowlist: ALLOWLIST,
        maxBodyBytes: 1000,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
  });

  it('wraps a network-level failure as SITE_UNREACHABLE', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'SITE_UNREACHABLE' });
  });

  it('closes the agent when the request fails outright', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(
      proxyFetch('https://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 }),
    ).rejects.toThrow();
    expect(agentCloseMock).toHaveBeenCalledTimes(1);
  });

  it('ProxyFetchError carries a stable, machine-readable code', async () => {
    try {
      await proxyFetch('ftp://example.com/', { method: 'GET', allowlist: ALLOWLIST, maxBodyBytes: 1000 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProxyFetchError);
      expect((error as InstanceType<typeof ProxyFetchError>).code).toBe('UNSAFE_URL');
    }
  });
});
