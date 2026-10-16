import { NextResponse } from 'next/server';
import { checkBuildSecret } from '@/lib/buildAuth';
import { readBuildStatus, writeBuildStatus } from '@/lib/storage';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  if (!checkBuildSecret(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const log = typeof body?.log === 'string' ? body.log : 'Сборка завершилась с ошибкой';

  const current = await readBuildStatus(id);
  await writeBuildStatus(id, { ...(current ?? { status: 'failed' }), status: 'failed', error: log, finishedAt: Date.now() });

  return NextResponse.json({ ok: true });
}
