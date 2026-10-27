import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server.js';
import { GithubActionsRunner } from './github-actions-runner.js';

describe('GithubActionsRunner', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterAll(() => server.close());
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

  it('POSTs a workflow_dispatch with the exact ref/workflow/inputs shape, authenticated with GITHUB_DISPATCH_TOKEN', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'gh-dispatch-token';
    process.env.GITHUB_REPO = 'serob111/iosmobilio2';
    process.env.GITHUB_WORKFLOW = 'build-ipa.yml';
    process.env.GITHUB_REF = 'main';

    let capturedAuth: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post(
        'https://api.github.com/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/dispatches',
        async ({ request }) => {
          capturedAuth = request.headers.get('authorization');
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const runner = new GithubActionsRunner();
    await runner.dispatch({ id: 'build-1', token: 'raw-token-value', baseUrl: 'https://example.com' });

    expect(capturedAuth).toBe('Bearer gh-dispatch-token');
    expect(capturedBody).toEqual({
      ref: 'main',
      inputs: { buildId: 'build-1', buildToken: 'raw-token-value', baseUrl: 'https://example.com' },
    });
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
