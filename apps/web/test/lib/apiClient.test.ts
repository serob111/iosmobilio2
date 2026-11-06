import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import {
  ApiError,
  buildIpaUrl,
  claimDraft,
  createDraft,
  createDraftEditorPreviewLink,
  createDraftPreviewLink,
  createProjectEditorPreviewLink,
  createProjectPreviewLink,
  draftIconUrl,
  fetchDraftPreviewLink,
  fetchMe,
  fetchPreviewDto,
  fetchProject,
  fetchProjectPreviewLink,
  getBuild,
  getMyDraft,
  listBuilds,
  listProjects,
  projectIconUrl,
  regenerateDraftPreviewLink,
  regenerateProjectPreviewLink,
  startBuild,
  updateDraftConfig,
  updateProjectConfig,
  uploadDraftIcon,
  uploadProjectIcon,
} from '../../lib/apiClient';

const API_BASE = 'http://localhost:3011';

const SAMPLE_CONFIG = {
  id: 'cfg-1',
  name: 'Sample',
  slug: 'sample',
  bundleId: 'am.mobilio.app.sample',
  source: { type: 'url' as const, url: 'https://sample.example' },
  theme: { primary: '#4B2BE0', background: '#FFFFFF', statusBar: 'dark' as const },
  tabs: [{ title: 'Home', icon: 'home', path: '/' }],
  features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
  allowedDomains: ['sample.example'],
  trial: true,
};

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

  it("throws an ApiError carrying the response body's error.code+error.message", async () => {
    server.use(
      http.get(`${API_BASE}/me`, () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'nope' } }, { status: 403 })),
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

describe('fetchPreviewDto', () => {
  it('returns the dto for an existing slug', async () => {
    const dto = {
      name: 'Cafe',
      theme: { primary: '#123456', background: '#FFFFFF', statusBar: 'dark' as const },
      statusBar: 'dark' as const,
      tabs: [{ title: 'Home', icon: 'home', path: '/' }],
      iconUrl: 'http://proxy.test/icon.png',
      proxyBase: 'http://proxy.test',
    };
    server.use(http.get(`${API_BASE}/preview/slug1`, () => HttpResponse.json(dto)));

    await expect(fetchPreviewDto('slug1')).resolves.toEqual(dto);
  });

  it('returns null for a 404 (revoked/expired/unknown slug)', async () => {
    server.use(http.get(`${API_BASE}/preview/gone`, () => new HttpResponse(null, { status: 404 })));
    await expect(fetchPreviewDto('gone')).resolves.toBeNull();
  });
});

describe('createDraft', () => {
  it('POSTs the url and resolves on success', async () => {
    let captured: { method: string; body: unknown } | null = null;
    server.use(
      http.post(`${API_BASE}/drafts`, async ({ request }) => {
        captured = { method: request.method, body: await request.json() };
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );

    await createDraft('example.com');

    expect(captured).toEqual({ method: 'POST', body: { url: 'example.com' } });
  });

  it('throws an ApiError on a validation failure', async () => {
    server.use(
      http.post(`${API_BASE}/drafts`, () =>
        HttpResponse.json({ error: { code: 'INVALID_URL', message: 'bad url' } }, { status: 400 }),
      ),
    );
    await expect(createDraft('not a url')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });
});

describe('getMyDraft', () => {
  it('returns the draft summary when a draft cookie is present', async () => {
    const summary = {
      id: 'draft-1',
      name: 'Draft',
      sourceUrl: 'https://sample.example',
      config: SAMPLE_CONFIG,
      configVersion: 1,
      expiresAt: new Date().toISOString(),
    };
    server.use(http.get(`${API_BASE}/drafts/me`, () => HttpResponse.json(summary)));
    await expect(getMyDraft()).resolves.toEqual(summary);
  });

  it('returns null when there is no draft (404)', async () => {
    server.use(http.get(`${API_BASE}/drafts/me`, () => new HttpResponse(null, { status: 404 })));
    await expect(getMyDraft()).resolves.toBeNull();
  });
});

describe('updateDraftConfig', () => {
  it('PUTs the full config and returns the server-authoritative copy', async () => {
    let captured: { method: string; body: unknown } | null = null;
    server.use(
      http.put(`${API_BASE}/drafts/me`, async ({ request }) => {
        captured = { method: request.method, body: await request.json() };
        return HttpResponse.json({ ...SAMPLE_CONFIG, name: 'Echoed' });
      }),
    );

    const result = await updateDraftConfig(SAMPLE_CONFIG);
    expect(captured).toEqual({ method: 'PUT', body: SAMPLE_CONFIG });
    expect(result.name).toBe('Echoed');
  });
});

describe('uploadDraftIcon', () => {
  it('POSTs the file as multipart/form-data', async () => {
    let receivedFilename: string | null = null;
    server.use(
      http.post(`${API_BASE}/drafts/me/icon`, async ({ request }) => {
        const formData = await request.formData();
        const file = formData.get('icon') as File;
        receivedFilename = file.name;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );

    const file = new File(['bytes'], 'icon.png', { type: 'image/png' });
    await uploadDraftIcon(file);
    expect(receivedFilename).toBe('icon.png');
  });
});

describe('draftIconUrl', () => {
  it('builds a plain url without a version param when none is given', () => {
    expect(draftIconUrl()).toBe(`${API_BASE}/drafts/me/icon`);
  });

  it('includes a cache-busting version param when given', () => {
    expect(draftIconUrl(1234)).toBe(`${API_BASE}/drafts/me/icon?v=1234`);
  });
});

describe('createDraftPreviewLink', () => {
  it('POSTs with no body and returns the preview url', async () => {
    server.use(
      http.post(`${API_BASE}/drafts/me/preview-link`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/abc' }, { status: 201 }),
      ),
    );
    await expect(createDraftPreviewLink()).resolves.toEqual({ url: 'http://localhost:3100/preview/abc' });
  });
});

describe('createDraftEditorPreviewLink', () => {
  it('POSTs to the editor sub-path, distinct from the share-link endpoint', async () => {
    server.use(
      http.post(`${API_BASE}/drafts/me/preview-link/editor`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/editor-abc' }, { status: 201 }),
      ),
    );
    await expect(createDraftEditorPreviewLink()).resolves.toEqual({ url: 'http://localhost:3100/preview/editor-abc' });
  });
});

describe('fetchDraftPreviewLink', () => {
  it('returns the active share link when one exists', async () => {
    server.use(
      http.get(`${API_BASE}/drafts/me/preview-link`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/abc' }),
      ),
    );
    await expect(fetchDraftPreviewLink()).resolves.toEqual({ url: 'http://localhost:3100/preview/abc' });
  });

  it('returns null (not an error) when none exists yet (404)', async () => {
    server.use(http.get(`${API_BASE}/drafts/me/preview-link`, () => new HttpResponse(null, { status: 404 })));
    await expect(fetchDraftPreviewLink()).resolves.toBeNull();
  });
});

describe('regenerateDraftPreviewLink', () => {
  it('POSTs to the regenerate sub-path', async () => {
    server.use(
      http.post(`${API_BASE}/drafts/me/preview-link/regenerate`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/new-abc' }, { status: 201 }),
      ),
    );
    await expect(regenerateDraftPreviewLink()).resolves.toEqual({ url: 'http://localhost:3100/preview/new-abc' });
  });
});

describe('claimDraft', () => {
  it('POSTs to the org-scoped claim endpoint and returns the new project id', async () => {
    server.use(
      http.post(`${API_BASE}/orgs/org1/drafts/claim`, () => HttpResponse.json({ id: 'project-1' }, { status: 201 })),
    );
    await expect(claimDraft('org1')).resolves.toEqual({ id: 'project-1' });
  });
});

describe('listProjects', () => {
  it('returns the org\'s projects', async () => {
    const rows = [{ id: 'p1', name: 'A', sourceUrl: 'https://a.example', createdAt: 'now', updatedAt: 'now' }];
    server.use(http.get(`${API_BASE}/orgs/org1/projects`, () => HttpResponse.json(rows)));
    await expect(listProjects('org1')).resolves.toEqual(rows);
  });
});

describe('fetchProject', () => {
  it('returns the full project when it exists', async () => {
    const project = { id: 'p1', name: 'A', sourceUrl: 'https://a.example', config: SAMPLE_CONFIG, configVersion: 1 };
    server.use(http.get(`${API_BASE}/orgs/org1/projects/p1`, () => HttpResponse.json(project)));
    await expect(fetchProject('org1', 'p1')).resolves.toEqual(project);
  });

  it('returns null for a project that does not exist (404)', async () => {
    server.use(http.get(`${API_BASE}/orgs/org1/projects/missing`, () => new HttpResponse(null, { status: 404 })));
    await expect(fetchProject('org1', 'missing')).resolves.toBeNull();
  });
});

describe('updateProjectConfig', () => {
  it('PUTs the full config scoped to the org/project', async () => {
    let capturedUrl = '';
    server.use(
      http.put(`${API_BASE}/orgs/org1/projects/p1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(SAMPLE_CONFIG);
      }),
    );
    await updateProjectConfig('org1', 'p1', SAMPLE_CONFIG);
    expect(capturedUrl).toBe(`${API_BASE}/orgs/org1/projects/p1`);
  });
});

describe('uploadProjectIcon', () => {
  it('POSTs the file as multipart/form-data scoped to the org/project', async () => {
    server.use(http.post(`${API_BASE}/orgs/org1/projects/p1/icon`, () => HttpResponse.json({ ok: true }, { status: 201 })));
    const file = new File(['bytes'], 'icon.png', { type: 'image/png' });
    await expect(uploadProjectIcon('org1', 'p1', file)).resolves.toBeUndefined();
  });
});

describe('projectIconUrl', () => {
  it('builds the org/project-scoped icon url', () => {
    expect(projectIconUrl('org1', 'p1')).toBe(`${API_BASE}/orgs/org1/projects/p1/icon`);
    expect(projectIconUrl('org1', 'p1', 42)).toBe(`${API_BASE}/orgs/org1/projects/p1/icon?v=42`);
  });
});

describe('createProjectPreviewLink', () => {
  it('POSTs to the org/project-scoped preview-link endpoint', async () => {
    server.use(
      http.post(`${API_BASE}/orgs/org1/projects/p1/preview-link`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/xyz' }, { status: 201 }),
      ),
    );
    await expect(createProjectPreviewLink('org1', 'p1')).resolves.toEqual({ url: 'http://localhost:3100/preview/xyz' });
  });
});

describe('createProjectEditorPreviewLink', () => {
  it('POSTs to the editor sub-path, distinct from the share-link endpoint', async () => {
    server.use(
      http.post(`${API_BASE}/orgs/org1/projects/p1/preview-link/editor`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/editor-xyz' }, { status: 201 }),
      ),
    );
    await expect(createProjectEditorPreviewLink('org1', 'p1')).resolves.toEqual({
      url: 'http://localhost:3100/preview/editor-xyz',
    });
  });
});

describe('fetchProjectPreviewLink', () => {
  it('returns the active share link when one exists', async () => {
    server.use(
      http.get(`${API_BASE}/orgs/org1/projects/p1/preview-link`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/xyz' }),
      ),
    );
    await expect(fetchProjectPreviewLink('org1', 'p1')).resolves.toEqual({ url: 'http://localhost:3100/preview/xyz' });
  });

  it('returns null (not an error) when none exists yet (404)', async () => {
    server.use(
      http.get(`${API_BASE}/orgs/org1/projects/p1/preview-link`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(fetchProjectPreviewLink('org1', 'p1')).resolves.toBeNull();
  });
});

describe('regenerateProjectPreviewLink', () => {
  it('POSTs to the regenerate sub-path', async () => {
    server.use(
      http.post(`${API_BASE}/orgs/org1/projects/p1/preview-link/regenerate`, () =>
        HttpResponse.json({ url: 'http://localhost:3100/preview/new-xyz' }, { status: 201 }),
      ),
    );
    await expect(regenerateProjectPreviewLink('org1', 'p1')).resolves.toEqual({
      url: 'http://localhost:3100/preview/new-xyz',
    });
  });
});

describe('builds', () => {
  it('startBuild POSTs and returns the new build id/status', async () => {
    server.use(
      http.post(`${API_BASE}/orgs/org1/projects/p1/builds`, () =>
        HttpResponse.json({ id: 'build-1', status: 'queued' }, { status: 201 }),
      ),
    );
    await expect(startBuild('org1', 'p1')).resolves.toEqual({ id: 'build-1', status: 'queued' });
  });

  it('listBuilds returns every build for the project', async () => {
    const rows = [
      { id: 'build-1', status: 'done', runId: null, error: null, startedAt: null, finishedAt: null, createdAt: 'now' },
    ];
    server.use(http.get(`${API_BASE}/orgs/org1/projects/p1/builds`, () => HttpResponse.json(rows)));
    await expect(listBuilds('org1', 'p1')).resolves.toEqual(rows);
  });

  it('getBuild returns a single build by id', async () => {
    const row = { id: 'build-1', status: 'building', runId: 123, error: null, startedAt: 'now', finishedAt: null, createdAt: 'now' };
    server.use(http.get(`${API_BASE}/orgs/org1/projects/p1/builds/build-1`, () => HttpResponse.json(row)));
    await expect(getBuild('org1', 'p1', 'build-1')).resolves.toEqual(row);
  });

  it("buildIpaUrl builds a plain href, deliberately not runUrl", () => {
    expect(buildIpaUrl('org1', 'p1', 'build-1')).toBe(`${API_BASE}/orgs/org1/projects/p1/builds/build-1/ipa`);
  });
});
