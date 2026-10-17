import { readFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { server } from '../mocks/server';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const SITE_HTML = readFileSync(path.join(FIXTURES_DIR, 'apple-touch-icon.html'), 'utf8');
const ICON_BYTES = readFileSync(path.join(FIXTURES_DIR, 'icon-source.png'));

let tempDir: string;
let projectsRoute: typeof import('../../app/api/projects/route');
let projectRoute: typeof import('../../app/api/projects/[id]/route');
let iconRoute: typeof import('../../app/api/projects/[id]/icon/route');

function jsonRequest(url: string, method: string, body?: unknown, headers?: Record<string, string>) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mobilio-api-test-'));
  process.env.DATA_DIR = tempDir;

  projectsRoute = await import('../../app/api/projects/route');
  projectRoute = await import('../../app/api/projects/[id]/route');
  iconRoute = await import('../../app/api/projects/[id]/icon/route');
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

function serveTestSite() {
  server.use(
    http.get('http://test.local/', () =>
      HttpResponse.text(SITE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ),
    http.get('http://test.local/icon-source.png', () =>
      HttpResponse.arrayBuffer(ICON_BYTES.buffer.slice(ICON_BYTES.byteOffset, ICON_BYTES.byteOffset + ICON_BYTES.byteLength), {
        headers: { 'content-type': 'image/png' },
      }),
    ),
    http.get('http://test.local/favicon-small.png', () => new HttpResponse(null, { status: 404 })),
  );
}

describe('POST /api/projects', () => {
  it('rejects a missing url', async () => {
    const res = await projectsRoute.POST(
      jsonRequest('http://localhost/api/projects', 'POST', {}, { 'x-forwarded-for': '198.51.100.1' }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unanalyzable site with a clear error', async () => {
    server.use(http.get('http://test.local/', () => new HttpResponse('boom', { status: 500 })));
    const res = await projectsRoute.POST(
      jsonRequest('http://localhost/api/projects', 'POST', { url: 'http://test.local' }, { 'x-forwarded-for': '198.51.100.2' }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('ошибкой 500');
  });

  it('creates a project from an analyzed site', async () => {
    serveTestSite();
    const res = await projectsRoute.POST(
      jsonRequest('http://localhost/api/projects', 'POST', { url: 'http://test.local' }, { 'x-forwarded-for': '198.51.100.3' }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toMatch(/^p_[a-f0-9]+$/);
  });

  it('enforces the per-ip rate limit', async () => {
    serveTestSite();
    const ip = '198.51.100.4';
    for (let i = 0; i < 10; i++) {
      const res = await projectsRoute.POST(
        jsonRequest('http://localhost/api/projects', 'POST', { url: 'http://test.local' }, { 'x-forwarded-for': ip }),
      );
      expect(res.status).toBe(200);
    }
    const blocked = await projectsRoute.POST(
      jsonRequest('http://localhost/api/projects', 'POST', { url: 'http://test.local' }, { 'x-forwarded-for': ip }),
    );
    expect(blocked.status).toBe(429);
  });
});

describe('GET/PUT /api/projects/[id]', () => {
  let projectId: string;

  beforeAll(async () => {
    serveTestSite();
    const res = await projectsRoute.POST(
      jsonRequest('http://localhost/api/projects', 'POST', { url: 'http://test.local' }, { 'x-forwarded-for': '198.51.100.10' }),
    );
    projectId = (await res.json()).id;
  });

  it('GET returns 404 for an unknown project', async () => {
    const res = await projectRoute.GET(new Request('http://localhost/api/projects/p_doesnotexist'), {
      params: Promise.resolve({ id: 'p_doesnotexist' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET returns the stored config', async () => {
    const res = await projectRoute.GET(new Request(`http://localhost/api/projects/${projectId}`), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config.id).toBe(projectId);
    expect(config.name).toBe('Кофейня Уют');
  });

  it('PUT rejects a body whose id does not match the url param', async () => {
    const getRes = await projectRoute.GET(new Request(`http://localhost/api/projects/${projectId}`), {
      params: Promise.resolve({ id: projectId }),
    });
    const config = await getRes.json();

    const res = await projectRoute.PUT(
      jsonRequest(`http://localhost/api/projects/${projectId}`, 'PUT', { ...config, id: 'p_somethingelse' }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });

  it('PUT rejects an invalid config', async () => {
    const res = await projectRoute.PUT(
      jsonRequest(`http://localhost/api/projects/${projectId}`, 'PUT', { id: projectId }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });

  it('PUT saves a valid edit and GET reflects it', async () => {
    const getRes = await projectRoute.GET(new Request(`http://localhost/api/projects/${projectId}`), {
      params: Promise.resolve({ id: projectId }),
    });
    const config = await getRes.json();

    const putRes = await projectRoute.PUT(
      jsonRequest(`http://localhost/api/projects/${projectId}`, 'PUT', { ...config, name: 'Renamed Cafe' }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(putRes.status).toBe(200);

    const after = await projectRoute.GET(new Request(`http://localhost/api/projects/${projectId}`), {
      params: Promise.resolve({ id: projectId }),
    });
    expect((await after.json()).name).toBe('Renamed Cafe');
  });

  it('icon GET serves the analyzed icon, then POST replaces it', async () => {
    const iconRes = await iconRoute.GET(new Request(`http://localhost/api/projects/${projectId}/icon`), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(iconRes.status).toBe(200);
    expect(iconRes.headers.get('content-type')).toBe('image/png');

    const formData = new FormData();
    formData.append('icon', new Blob([ICON_BYTES], { type: 'image/png' }), 'icon.png');
    const uploadRequest = new Request(`http://localhost/api/projects/${projectId}/icon`, {
      method: 'POST',
      body: formData,
    });
    const uploadRes = await iconRoute.POST(uploadRequest, { params: Promise.resolve({ id: projectId }) });
    expect(uploadRes.status).toBe(200);
  });

  it('icon POST rejects a non-image file', async () => {
    const formData = new FormData();
    formData.append('icon', new Blob(['not an image'], { type: 'text/plain' }), 'file.txt');
    const uploadRequest = new Request(`http://localhost/api/projects/${projectId}/icon`, {
      method: 'POST',
      body: formData,
    });
    const res = await iconRoute.POST(uploadRequest, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(400);
  });
});
