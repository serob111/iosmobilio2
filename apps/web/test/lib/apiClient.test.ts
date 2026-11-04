import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { ApiError, fetchMe } from '../../lib/apiClient';

const API_BASE = 'http://localhost:3011';

describe('fetchMe', () => {
  it('returns the parsed response when signed in', async () => {
    const payload = {
      user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
      organizations: [{ id: 'org1', name: 'Acme', slug: 'acme', role: 'owner' as const }],
    };
    server.use(http.get(`${API_BASE}/me`, () => HttpResponse.json(payload)));

    await expect(fetchMe()).resolves.toEqual(payload);
  });

  it('returns null when signed out (401)', async () => {
    server.use(
      http.get(`${API_BASE}/me`, () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 }),
      ),
    );

    await expect(fetchMe()).resolves.toBeNull();
  });

  it('throws an ApiError carrying the response body\'s error.code+error.message', async () => {
    server.use(
      http.get(`${API_BASE}/me`, () =>
        HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'nope' } }, { status: 403 }),
      ),
    );

    const error = await fetchMe().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('FORBIDDEN');
    expect((error as ApiError).message).toBe('nope');
  });

  it('falls back to code "UNKNOWN" and a generic message when the error body has no code/message (e.g. a bare 500 with no body)', async () => {
    server.use(http.get(`${API_BASE}/me`, () => new HttpResponse(null, { status: 500 })));

    const error = await fetchMe().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UNKNOWN');
    expect((error as ApiError).message).toBe('Request failed with status 500');
  });
});
