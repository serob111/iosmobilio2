import { NextResponse } from 'next/server';
import { checkBuildSecret } from '@/lib/buildAuth';
import { readBuildStatus, readConfig, readIpa, writeBuildStatus, writeIpa } from '@/lib/storage';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  if (!checkBuildSecret(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const formData = await request.formData();
  const file = formData.get('ipa');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Нет файла .ipa в запросе' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeIpa(id, buffer);

  const current = await readBuildStatus(id);
  await writeBuildStatus(id, { ...(current ?? { status: 'done' }), status: 'done', finishedAt: Date.now() });

  return NextResponse.json({ ok: true });
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const [buffer, config] = await Promise.all([readIpa(id), readConfig(id)]);
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${config.slug}.ipa"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
  }
}
