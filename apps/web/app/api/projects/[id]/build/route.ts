import { NextResponse } from 'next/server';
import { dispatchBuildWorkflow, findRunForProject, getRun, mapGithubRunToStatus } from '@/lib/github';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { projectExists, readBuildStatus, writeBuildStatus, type BuildStatus } from '@/lib/storage';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`build:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 });
  }

  const existing = await readBuildStatus(id);
  if (existing && (existing.status === 'queued' || existing.status === 'building')) {
    return NextResponse.json({ error: 'Сборка уже идёт' }, { status: 409 });
  }

  try {
    await dispatchBuildWorkflow(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось запустить сборку';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const status: BuildStatus = { status: 'queued', dispatchedAt: Date.now() };
  await writeBuildStatus(id, status);
  return NextResponse.json(status);
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const current = await readBuildStatus(id);
  if (!current) {
    return NextResponse.json({ status: 'none' });
  }

  if (current.status !== 'queued' && current.status !== 'building') {
    return NextResponse.json(current);
  }

  try {
    let runId = current.runId;
    if (!runId) {
      const run = await findRunForProject(id, current.dispatchedAt ?? 0);
      if (run) runId = run.id;
    }
    if (runId) {
      const run = await getRun(runId);
      if (run) {
        const next: BuildStatus = {
          ...current,
          runId: run.id,
          workflowRunUrl: run.html_url,
          status: mapGithubRunToStatus(run),
          finishedAt: run.status === 'completed' ? Date.now() : current.finishedAt,
        };
        await writeBuildStatus(id, next);
        return NextResponse.json(next);
      }
    }
  } catch {
    // Transient GitHub API hiccup — fall through and return the last known status.
  }

  return NextResponse.json(current);
}
