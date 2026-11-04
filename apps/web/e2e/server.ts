/**
 * Test-only bootstrap for Playwright E2E: starts the real Next.js app programmatically
 * so the e2e webServer has something listening on :3100. The current specs either mock
 * at the browser's network boundary (page.route()) or hit the real apps/api directly —
 * neither needs anything mocked at this server's own network boundary.
 */
import { createServer } from 'http';
import path from 'path';

const PORT = 3100;

async function main() {
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
