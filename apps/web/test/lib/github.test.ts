import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/server';
import { dispatchBuildWorkflow, findRunForProject, getRun, mapGithubRunToStatus } from '../../lib/github';

const GITHUB_API = 'https://api.github.com';

describe('mapGithubRunToStatus', () => {
  it('maps queued', () => {
    expect(mapGithubRunToStatus({ id: 1, status: 'queued', conclusion: null, html_url: '' })).toBe('queued');
  });

  it('maps in_progress to building', () => {
    expect(mapGithubRunToStatus({ id: 1, status: 'in_progress', conclusion: null, html_url: '' })).toBe('building');
  });

  it('maps completed+success to done', () => {
    expect(mapGithubRunToStatus({ id: 1, status: 'completed', conclusion: 'success', html_url: '' })).toBe('done');
  });

  it('maps completed+failure to failed', () => {
    expect(mapGithubRunToStatus({ id: 1, status: 'completed', conclusion: 'failure', html_url: '' })).toBe('failed');
  });
});

describe('github.ts env-dependent functions', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubEnv('GITHUB_REPO', 'serob111/iosmobilio2');
    vi.stubEnv('GITHUB_REF', 'main');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('dispatchBuildWorkflow', () => {
    it('throws a clear error when GITHUB_TOKEN/GITHUB_REPO are missing', async () => {
      vi.unstubAllEnvs();
      await expect(dispatchBuildWorkflow('p_test')).rejects.toThrow('GITHUB_TOKEN/GITHUB_REPO не настроены');
    });

    it('resolves on a successful dispatch and sends the expected body', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${GITHUB_API}/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/dispatches`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          },
        ),
      );

      await expect(dispatchBuildWorkflow('p_abc123')).resolves.toBeUndefined();
      expect(capturedBody).toEqual({
        ref: 'main',
        inputs: { projectId: 'p_abc123', useTestConfig: 'false' },
      });
    });

    it('throws with the status and body on a non-ok response', async () => {
      server.use(
        http.post(
          `${GITHUB_API}/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/dispatches`,
          () => new HttpResponse('Resource not accessible by personal access token', { status: 403 }),
        ),
      );

      await expect(dispatchBuildWorkflow('p_abc123')).rejects.toThrow(/403.*not accessible/);
    });
  });

  describe('findRunForProject', () => {
    const runsUrl = `${GITHUB_API}/repos/serob111/iosmobilio2/actions/workflows/build-ipa.yml/runs`;

    it('matches a run whose display_title contains the projectId and was created after `sinceMs`', async () => {
      const now = Date.now();
      server.use(
        http.get(runsUrl, () =>
          HttpResponse.json({
            workflow_runs: [
              {
                id: 1,
                status: 'queued',
                conclusion: null,
                html_url: 'https://github.com/x/y/actions/runs/1',
                display_title: 'build p_other',
                created_at: new Date(now).toISOString(),
              },
              {
                id: 2,
                status: 'in_progress',
                conclusion: null,
                html_url: 'https://github.com/x/y/actions/runs/2',
                display_title: 'build p_abc123',
                created_at: new Date(now).toISOString(),
              },
            ],
          }),
        ),
      );

      const run = await findRunForProject('p_abc123', now - 1000);
      expect(run?.id).toBe(2);
    });

    it('ignores runs created well before `sinceMs`', async () => {
      const now = Date.now();
      server.use(
        http.get(runsUrl, () =>
          HttpResponse.json({
            workflow_runs: [
              {
                id: 3,
                status: 'completed',
                conclusion: 'success',
                html_url: '',
                display_title: 'build p_abc123',
                created_at: new Date(now - 60_000).toISOString(),
              },
            ],
          }),
        ),
      );

      const run = await findRunForProject('p_abc123', now);
      expect(run).toBeNull();
    });

    it('returns null on a non-ok response instead of throwing', async () => {
      server.use(http.get(runsUrl, () => new HttpResponse(null, { status: 500 })));
      await expect(findRunForProject('p_abc123', Date.now())).resolves.toBeNull();
    });
  });

  describe('getRun', () => {
    it('returns the parsed run on success', async () => {
      server.use(
        http.get(`${GITHUB_API}/repos/serob111/iosmobilio2/actions/runs/42`, () =>
          HttpResponse.json({ id: 42, status: 'completed', conclusion: 'success', html_url: 'https://x' }),
        ),
      );
      const run = await getRun(42);
      expect(run).toEqual({ id: 42, status: 'completed', conclusion: 'success', html_url: 'https://x' });
    });

    it('returns null on a non-ok response', async () => {
      server.use(http.get(`${GITHUB_API}/repos/serob111/iosmobilio2/actions/runs/42`, () => new HttpResponse(null, { status: 404 })));
      await expect(getRun(42)).resolves.toBeNull();
    });
  });
});
