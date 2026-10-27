import { randomBytes } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server.js';
import { GithubActionsRunner } from './github-actions-runner.js';
import { decryptBuildToken } from './build-token-crypto.js';

const BUILD_TOKEN_KEY = randomBytes(32).toString('base64');

describe('GithubActionsRunner', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterAll(() => server.close());
  beforeEach(() => {
    process.env.BUILD_TOKEN_KEY = BUILD_TOKEN_KEY;
  });
  afterEach(() => {
    server.resetHandlers();
    process.env = { ...originalEnv };
  });

  it('throws without calling GitHub when GITHUB_DISPATCH_TOKEN/GITHUB_REPO are not configured', async () => {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.GITHUB_REPO;
    const runner = new GithubActionsRunner();

    await expect(runner.dispatch({ id: 'build-1', token: 'raw-token', baseUrl: 'https://example.com' })).rejects.toThrow(
      /GITHUB_DISPATCH_TOKEN/,
    );
  });

  it('POSTs a workflow_dispatch with buildId/baseUrl in the clear and the token only as ciphertext, authenticated with GITHUB_DISPATCH_TOKEN', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'gh-dispatch-token';
    process.env.GITHUB_REPO = 'serob111/iosmobilio2';
    process.env.GITHUB_WORKFLOW = 'build-ipa.yml';
    process.env.GITHUB_REF = 'main';

    let capturedAuth: string | null = null;
    let capturedBody: { ref: string; inputs: { buildId: string; buildTokenEnc: string; baseUrl: string } } | undefined;
    server.use(
      http.post(
        'https://api.github.com/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/dispatches',
        async ({ request }) => {
          capturedAuth = request.headers.get('authorization');
          capturedBody = (await request.json()) as typeof capturedBody;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const runner = new GithubActionsRunner();
    await runner.dispatch({ id: 'build-1', token: 'raw-token-value', baseUrl: 'https://example.com' });

    expect(capturedAuth).toBe('Bearer gh-dispatch-token');
    expect(capturedBody?.ref).toBe('main');
    expect(capturedBody?.inputs.buildId).toBe('build-1');
    expect(capturedBody?.inputs.baseUrl).toBe('https://example.com');
    // Never the raw token itself in the dispatch body — only a ciphertext that decrypts
    // back to it with the same BUILD_TOKEN_KEY the workflow's own secret would hold.
    expect(capturedBody?.inputs.buildTokenEnc).not.toBe('raw-token-value');
    expect(decryptBuildToken(capturedBody!.inputs.buildTokenEnc)).toBe('raw-token-value');
  });

  it('defaults GITHUB_WORKFLOW to build-ipa.yml and GITHUB_REF to main when unset', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'gh-dispatch-token';
    process.env.GITHUB_REPO = 'serob111/iosmobilio2';
    delete process.env.GITHUB_WORKFLOW;
    delete process.env.GITHUB_REF;

    let hit = false;
    server.use(
      http.post(
        'https://api.github.com/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/dispatches',
        async ({ request }) => {
          hit = true;
          const body = (await request.json()) as { ref: string };
          expect(body.ref).toBe('main');
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const runner = new GithubActionsRunner();
    await runner.dispatch({ id: 'build-1', token: 'raw-token', baseUrl: 'https://example.com' });
    expect(hit).toBe(true);
  });

  it('throws with the status and response body when GitHub responds with an error', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'gh-dispatch-token';
    process.env.GITHUB_REPO = 'serob111/iosmobilio2';

    server.use(
      http.post(
        'https://api.github.com/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/dispatches',
        () => HttpResponse.text('bad credentials', { status: 401 }),
      ),
    );

    const runner = new GithubActionsRunner();
    await expect(
      runner.dispatch({ id: 'build-1', token: 'raw-token', baseUrl: 'https://example.com' }),
    ).rejects.toThrow(/401.*bad credentials/s);
  });
});
