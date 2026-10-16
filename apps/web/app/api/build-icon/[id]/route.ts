import { NextResponse } from 'next/server';
import { checkBuildSecret } from '@/lib/buildAuth';
import { generateLetterAvatar } from '@/lib/analyzeSite';
import { readConfig, readIcon } from '@/lib/storage';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  if (!checkBuildSecret(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const buffer = await readIcon(id);
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    // No uploaded/analyzed icon on disk — fall back to a letter avatar from the config.
  }

  try {
    const config = await readConfig(id);
    const png = await generateLetterAvatar(config.name.charAt(0) || '?', config.theme.primary);
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  }
}
