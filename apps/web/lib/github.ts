const GITHUB_API = 'https://api.github.com';
const WORKFLOW_FILE = 'build-ipa.yml';

function getEnv(): { token: string; repo: string; ref: string } {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    throw new Error('GITHUB_TOKEN/GITHUB_REPO не настроены на сервере');
  }
  return { token, repo, ref: process.env.GITHUB_REF ?? 'main' };
}

async function githubFetch(path: string, init?: RequestInit): Promise<Response> {
  const { token } = getEnv();
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });
}

export async function dispatchBuildWorkflow(projectId: string): Promise<void> {
  const { repo, ref } = getEnv();
  const res = await githubFetch(`/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, inputs: { projectId, useTestConfig: 'false' } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Не удалось запустить сборку в GitHub Actions (${res.status}): ${text}`);
  }
}

export type GithubRun = {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
};

type RawRun = GithubRun & { display_title?: string; name?: string; created_at: string };

/** Matches a run by the projectId embedded in `run-name: build ${{ inputs.projectId }}`. */
export async function findRunForProject(projectId: string, sinceMs: number): Promise<GithubRun | null> {
  const { repo } = getEnv();
  const res = await githubFetch(
    `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { workflow_runs: RawRun[] };
  const candidates = data.workflow_runs.filter((run) => {
    const createdAt = new Date(run.created_at).getTime();
    if (createdAt < sinceMs - 10_000) return false;
    const title = run.display_title ?? run.name ?? '';
    return title.includes(projectId);
  });
  return candidates[0] ?? null;
}

export async function getRun(runId: number): Promise<GithubRun | null> {
  const { repo } = getEnv();
  const res = await githubFetch(`/repos/${repo}/actions/runs/${runId}`);
  if (!res.ok) return null;
  return (await res.json()) as GithubRun;
}

export function mapGithubRunToStatus(run: GithubRun): 'queued' | 'building' | 'done' | 'failed' {
  if (run.status !== 'completed') return run.status === 'queued' ? 'queued' : 'building';
  return run.conclusion === 'success' ? 'done' : 'failed';
}
