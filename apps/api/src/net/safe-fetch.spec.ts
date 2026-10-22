import { describe, expect, it, vi, beforeEach } from 'vitest';

const { lookupMock, fetchMock, agentCloseMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  fetchMock: vi.fn(),
  agentCloseMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

// safe-fetch.ts calls the *global* fetch (so MSW's FetchInterceptor can see it in
// analyze-site.spec.ts/projects.integration.spec.ts) but still constructs its own
// `undici.Agent` for the dispatcher — so Agent is mocked here, fetch via vi.stubGlobal.
vi.mock('undici', () => ({
  Agent: class {
    close = agentCloseMock;
  },
}));
vi.stubGlobal('fetch', fetchMock);

const { safeFetch, resolveSafeAddresses, SafeFetchError } = await import('./safe-fetch.js');

/** A minimal ReadableStream-like body matching what safeFetch's readLimited() consumes. */
function fakeBody(chunks: Buffer[]): {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
    cancel: () => Promise<void>;
  };
} {
  let index = 0;
  const cancel = vi.fn().mockResolvedValue(undefined);
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) return { done: true };
        const value = chunks[index++]!;
        return { done: false, value };
      },
      cancel,
    }),
  };
}

function fakeResponse(opts: {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer[];
}): unknown {
  const headerMap = new Map(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status: opts.status,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    body: fakeBody(opts.body ?? []),
  };
}

describe('resolveSafeAddresses (DNS-level checks)', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('rejects a bare (no-dot) hostname before even trying DNS', async () => {
    await expect(resolveSafeAddresses('minio')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects when DNS returns a mix of public and private addresses', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(resolveSafeAddresses('mixed.example')).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
  });

  it('accepts a hostname that resolves only to public addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const result = await resolveSafeAddresses('public.example');
    expect(result).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('wraps a DNS resolution failure as SITE_UNREACHABLE', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(resolveSafeAddresses('nowhere.example')).rejects.toMatchObject({
      code: 'SITE_UNREACHABLE',
    });
  });

  it('accepts a public IPv4 literal without calling DNS', async () => {
    const result = await resolveSafeAddresses('8.8.8.8');
    expect(result).toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects a private IPv4 literal without calling DNS', async () => {
    await expect(resolveSafeAddresses('10.0.0.1')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('safeFetch', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    fetchMock.mockReset();
    agentCloseMock.mockClear();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('rejects userinfo in the url without making any request', async () => {
    await expect(
      safeFetch('https://user:pass@public.example/', { maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-standard port without making any request', async () => {
    await expect(
      safeFetch('https://public.example:8443/', { maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a disallowed scheme without making any request', async () => {
    await expect(safeFetch('ftp://public.example/', { maxBodyBytes: 1000 })).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the body and status for a plain 200 response', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: [Buffer.from('hi')],
      }),
    );
    const result = await safeFetch('https://public.example/', { maxBodyBytes: 1000 });
    expect(result.status).toBe(200);
    expect(result.body.toString()).toBe('hi');
  });

  it('follows a redirect and re-validates the new host — public target is fine', async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ status: 302, headers: { location: 'https://other-public.example/' } }),
      )
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: [Buffer.from('final')] }));

    const result = await safeFetch('https://public.example/', { maxBodyBytes: 1000 });
    expect(result.status).toBe(200);
    expect(result.body.toString()).toBe('final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect from a public address to a literal loopback address', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ status: 302, headers: { location: 'http://127.0.0.1/' } }),
    );
    await expect(
      safeFetch('https://public.example/', { maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('rejects a redirect from a public address to the cloud metadata endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    await expect(
      safeFetch('https://public.example/', { maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('caps the number of redirects at the configured maximum', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 302, headers: { location: 'https://public.example/next' } }),
    );
    await expect(
      safeFetch('https://public.example/', { maxBodyBytes: 1000, maxRedirects: 2 }),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REDIRECTS',
    });
    // 1 initial + 2 allowed redirects followed = 3 fetch calls before the 4th would-be hop is rejected.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborts and rejects once the response body exceeds maxBodyBytes', async () => {
    const big = Buffer.alloc(600, 'x');
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: [big] }));
    await expect(safeFetch('https://public.example/', { maxBodyBytes: 500 })).rejects.toMatchObject(
      {
        code: 'RESPONSE_TOO_LARGE',
      },
    );
  });

  it('rejects a disallowed content-type without the caller needing its own check', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: [Buffer.from('{}')],
      }),
    );
    await expect(
      safeFetch('https://public.example/', {
        maxBodyBytes: 1000,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
  });

  it('wraps a network-level failure as SITE_UNREACHABLE', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      safeFetch('https://public.example/', { maxBodyBytes: 1000 }),
    ).rejects.toMatchObject({
      code: 'SITE_UNREACHABLE',
    });
  });

  it('always closes the agent, even when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(safeFetch('https://public.example/', { maxBodyBytes: 1000 })).rejects.toThrow();
    expect(agentCloseMock).toHaveBeenCalledTimes(1);
  });

  it('SafeFetchError carries a stable, machine-readable code', async () => {
    try {
      await safeFetch('ftp://public.example/', { maxBodyBytes: 1000 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SafeFetchError);
      expect((error as InstanceType<typeof SafeFetchError>).code).toBe('UNSAFE_URL');
    }
  });
});
