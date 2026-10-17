/**
 * Test-only bootstrap for Playwright E2E: starts MSW's node interceptor *inside this same
 * process* before starting Next.js programmatically, so the server's own outgoing fetch calls
 * (to the analyzed site, to the GitHub API) are mocked too — not just the browser's requests,
 * which Playwright's page.route() can't reach since those calls never go through the browser.
 * Zero changes to production route/lib code; this file is never imported by the app itself.
 */
import { createServer } from 'http';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const PORT = 3100;
const REPO = 'serob111/iosmobilio2';
const GITHUB_API = 'https://api.github.com';
const SITE_ORIGIN = 'https://e2e-test.local';

async function main() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'mobilio-e2e-'));
  process.env.DATA_DIR = tempDir;
  process.env.BUILD_SECRET = 'e2e-secret';
  process.env.GITHUB_TOKEN = 'e2e-token';
  process.env.GITHUB_REPO = REPO;
  process.env.PUBLIC_BASE_URL = `http://localhost:${PORT}`;

  // Dynamic import: storage.ts reads DATA_DIR at module-load time, so it must be imported
  // after the env var above is set.
  const { writeIpa } = await import('../lib/storage');

  const fixturesDir = path.resolve(__dirname, '../test/fixtures');
  const siteHtml = readFileSync(path.join(fixturesDir, 'apple-touch-icon.html'), 'utf8');
  const iconBytes = readFileSync(path.join(fixturesDir, 'icon-source.png'));
  const iconArrayBuffer = iconBytes.buffer.slice(iconBytes.byteOffset, iconBytes.byteOffset + iconBytes.byteLength);

  let lastDispatchedProjectId: string | null = null;
  let lastDispatchedAt = 0;
  const RUN_ID = 555;

  const mswServer = setupServer(
    http.get(`${SITE_ORIGIN}/`, () =>
      HttpResponse.text(siteHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ),
    http.get(`${SITE_ORIGIN}/icon-source.png`, () =>
      HttpResponse.arrayBuffer(iconArrayBuffer, { headers: { 'content-type': 'image/png' } }),
    ),
    http.get(`${SITE_ORIGIN}/favicon-small.png`, () => new HttpResponse(null, { status: 404 })),

    http.post(`${GITHUB_API}/repos/${REPO}/actions/workflows/build-ipa.yml/dispatches`, async ({ request }) => {
      const body = (await request.json()) as { inputs: { projectId: string } };
      lastDispatchedProjectId = body.inputs.projectId;
      lastDispatchedAt = Date.now();
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`${GITHUB_API}/repos/${REPO}/actions/workflows/build-ipa.yml/runs`, () =>
      HttpResponse.json({
        workflow_runs: [
          {
            id: RUN_ID,
            status: 'completed',
            conclusion: 'success',
            html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
            display_title: `build ${lastDispatchedProjectId}`,
            created_at: new Date(lastDispatchedAt).toISOString(),
          },
        ],
      }),
    ),

    // Simulates the whole CI pipeline completing: by the time the status-poll route reads
    // this "run", the .ipa it would have uploaded is already on disk.
    http.get(`${GITHUB_API}/repos/${REPO}/actions/runs/${RUN_ID}`, async () => {
      if (lastDispatchedProjectId) {
        await writeIpa(lastDispatchedProjectId, Buffer.from('fake e2e ipa bytes'));
      }
      return HttpResponse.json({
        id: RUN_ID,
        status: 'completed',
        conclusion: 'success',
        html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
      });
    }),
  );
  mswServer.listen({ onUnhandledFrame: 'bypass' });

  const next = (await import('next')).default;
  const app = next({ dev: true, dir: path.resolve(__dirname, '..') });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  console.log(`E2E server ready on http://localhost:${PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
