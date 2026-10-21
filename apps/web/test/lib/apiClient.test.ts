import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { fetchMe } from '../../lib/apiClient';

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

  it('throws on an unexpected error status', async () => {
    server.use(http.get(`${API_BASE}/me`, () => new HttpResponse(null, { status: 500 })));

    await expect(fetchMe()).rejects.toThrow('GET /me failed with status 500');
  });
});
