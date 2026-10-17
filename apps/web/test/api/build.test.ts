import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@mobilio/config';
import { server } from '../mocks/server';

const GITHUB_API = 'https://api.github.com';
const BUILD_SECRET = 'test-build-secret';
const PROJECT_ID = 'p_buildapitest';

let tempDir: string;
let storage: typeof import('../../lib/storage');
let buildRoute: typeof import('../../app/api/projects/[id]/build/route');
let ipaRoute: typeof import('../../app/api/projects/[id]/ipa/route');
let failedRoute: typeof import('../../app/api/projects/[id]/failed/route');
let buildConfigRoute: typeof import('../../app/api/build-config/[id]/route');
let buildIconRoute: typeof import('../../app/api/build-icon/[id]/route');

const sampleConfig: ProjectConfig = {
  id: PROJECT_ID,
  name: 'Build Api Test',
  slug: 'build-api-test',
  bundleId: 'am.mobilio.app.buildapitest',
  source: { type: 'url', url: 'https://example.com' },
  theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
  tabs: [{ title: 'Главная', icon: 'home', path: '/' }],
  features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
  allowedDomains: ['example.com'],
  trial: true,
};

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mobilio-build-api-test-'));
  process.env.DATA_DIR = tempDir;
  process.env.BUILD_SECRET = BUILD_SECRET;
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.GITHUB_REPO = 'serob111/iosmobilio2';
  process.env.PUBLIC_BASE_URL = 'http://test.local';

  storage = await import('../../lib/storage');
  buildRoute = await import('../../app/api/projects/[id]/build/route');
  ipaRoute = await import('../../app/api/projects/[id]/ipa/route');
  failedRoute = await import('../../app/api/projects/[id]/failed/route');
  buildConfigRoute = await import('../../app/api/build-config/[id]/route');
  buildIconRoute = await import('../../app/api/build-icon/[id]/route');

  await storage.writeConfig(PROJECT_ID, sampleConfig);
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  delete process.env.BUILD_SECRET;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPO;
  delete process.env.PUBLIC_BASE_URL;
  await rm(tempDir, { recursive: true, force: true });
});

const params = Promise.resolve({ id: PROJECT_ID });

describe('POST /api/projects/[id]/build', () => {
  it('404s for an unknown project', async () => {
    const res = await buildRoute.POST(new Request('http://localhost/x', { method: 'POST' }), {
      params: Promise.resolve({ id: 'p_doesnotexist' }),
    });
    expect(res.status).toBe(404);
  });

  it('dispatches the workflow and stores a queued status', async () => {
    server.use(
      http.post(
        `${GITHUB_API}/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/dispatches`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const res = await buildRoute.POST(new Request('http://localhost/x', { method: 'POST' }), { params });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('queued');
  });

  it('returns 409 while a build is already queued/building', async () => {
    const res = await buildRoute.POST(new Request('http://localhost/x', { method: 'POST' }), { params });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/projects/[id]/build', () => {
  it('returns {status: "none"} when nothing has been built yet', async () => {
    const res = await buildRoute.GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: 'p_neverbuilt1234' }),
    });
    expect((await res.json()).status).toBe('none');
  });

  it('resolves the GitHub run and updates status to building', async () => {
    const dispatchedAt = (await storage.readBuildStatus(PROJECT_ID))?.dispatchedAt ?? Date.now();
    server.use(
      http.get(
        `${GITHUB_API}/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/runs`,
        () =>
          HttpResponse.json({
            workflow_runs: [
              {
                id: 999,
                status: 'in_progress',
                conclusion: null,
                html_url: 'https://github.com/serob111/iosmobilio2/actions/runs/999',
                display_title: `build ${PROJECT_ID}`,
                created_at: new Date(dispatchedAt).toISOString(),
              },
            ],
          }),
      ),
      http.get(`${GITHUB_API}/repos/serob111/iosmobilio2/actions/runs/999`, () =>
        HttpResponse.json({
          id: 999,
          status: 'in_progress',
          conclusion: null,
          html_url: 'https://github.com/serob111/iosmobilio2/actions/runs/999',
        }),
      ),
    );

    const res = await buildRoute.GET(new Request('http://localhost/x'), { params });
    const data = await res.json();
    expect(data.status).toBe('building');
    expect(data.runId).toBe(999);
  });
});

describe('x-build-secret gated routes', () => {
  it('build-config: 403 without the secret, 200 with it', async () => {
    const noSecret = await buildConfigRoute.GET(new Request('http://localhost/x'), { params });
    expect(noSecret.status).toBe(403);

    const withSecret = await buildConfigRoute.GET(
      new Request('http://localhost/x', { headers: { 'x-build-secret': BUILD_SECRET } }),
      { params },
    );
    expect(withSecret.status).toBe(200);
    const data = await withSecret.json();
    expect(data.config.id).toBe(PROJECT_ID);
    expect(data.iconUrl).toBe(`http://test.local/api/build-icon/${PROJECT_ID}`);
  });

  it('build-icon: falls back to a generated letter avatar when no icon.png exists', async () => {
    const res = await buildIconRoute.GET(
      new Request('http://localhost/x', { headers: { 'x-build-secret': BUILD_SECRET } }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('build-icon: 403 without the secret', async () => {
    const res = await buildIconRoute.GET(new Request('http://localhost/x'), { params });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/projects/[id]/ipa and GET download', () => {
  it('rejects without the secret', async () => {
    const res = await ipaRoute.POST(new Request('http://localhost/x', { method: 'POST' }), { params });
    expect(res.status).toBe(403);
  });

  it('accepts a multipart upload, marks the build done, and becomes downloadable', async () => {
    const formData = new FormData();
    formData.append('ipa', new Blob(['fake ipa bytes'], { type: 'application/octet-stream' }), 'app.ipa');
    const uploadReq = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'x-build-secret': BUILD_SECRET },
      body: formData,
    });
    const uploadRes = await ipaRoute.POST(uploadReq, { params });
    expect(uploadRes.status).toBe(200);

    const status = await storage.readBuildStatus(PROJECT_ID);
    expect(status?.status).toBe('done');

    const downloadRes = await ipaRoute.GET(new Request('http://localhost/x'), { params });
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-disposition')).toBe('attachment; filename="build-api-test.ipa"');
  });

  it('download 404s for a project with no uploaded ipa', async () => {
    const otherId = 'p_noipaproject1';
    await storage.writeConfig(otherId, { ...sampleConfig, id: otherId, slug: 'no-ipa' });
    const res = await ipaRoute.GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: otherId }) });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/[id]/failed', () => {
  it('rejects without the secret', async () => {
    const res = await failedRoute.POST(new Request('http://localhost/x', { method: 'POST' }), { params });
    expect(res.status).toBe(403);
  });

  it('records the failure log and sets status to failed', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'x-build-secret': BUILD_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ log: 'xcodebuild: error: something broke' }),
    });
    const res = await failedRoute.POST(req, { params });
    expect(res.status).toBe(200);

    const status = await storage.readBuildStatus(PROJECT_ID);
    expect(status?.status).toBe('failed');
    expect(status?.error).toBe('xcodebuild: error: something broke');
  });
});
