import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { projectExists, readIcon, writeIcon } from '@/lib/storage';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const buffer = await readIcon(id);
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Иконка не найдена' }, { status: 404 });
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get('icon');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Прикрепите файл иконки' }, { status: 400 });
  }
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    return NextResponse.json({ error: 'Иконка должна быть в формате PNG или JPEG' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let iconBuffer: Buffer;
  try {
    iconBuffer = await sharp(buffer)
      .resize(1024, 1024, { fit: 'cover' })
      .flatten({ background: '#FFFFFF' })
      .png()
      .toBuffer();
  } catch {
    return NextResponse.json({ error: 'Не удалось обработать изображение' }, { status: 400 });
  }

  await writeIcon(id, iconBuffer);
  return NextResponse.json({ ok: true });
}
