import { NextResponse } from 'next/server';
import { parseProjectConfig } from '@mobilio/config';
import { projectExists, readConfig, writeConfig } from '@/lib/storage';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const config = await readConfig(id);
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { id } = await params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  const parsed = parseProjectConfig(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.errors.join('; ') }, { status: 400 });
  }

  if (parsed.data.id !== id) {
    return NextResponse.json({ error: 'Идентификатор проекта не совпадает' }, { status: 400 });
  }

  await writeConfig(id, parsed.data);
  return NextResponse.json(parsed.data);
}
