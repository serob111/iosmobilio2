import { NextResponse } from 'next/server';
import { checkBuildSecret } from '@/lib/buildAuth';
import { readConfig } from '@/lib/storage';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  if (!checkBuildSecret(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const config = await readConfig(id);
    const base = process.env.PUBLIC_BASE_URL ?? '';
    return NextResponse.json({ config, iconUrl: `${base}/api/build-icon/${id}` });
  } catch {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  }
}
