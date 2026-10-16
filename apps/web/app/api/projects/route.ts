import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deriveBundleId, parseProjectConfig, slugify, type ProjectConfigInput } from '@mobilio/config';
import { analyzeSite } from '@/lib/analyzeSite';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { createProjectId, writeConfig, writeIcon } from '@/lib/storage';

const BodySchema = z.object({ url: z.string().min(1, 'Укажите адрес сайта') });

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`create:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Укажите адрес сайта' }, { status: 400 });
  }

  let analysis;
  try {
    analysis = await analyzeSite(parsedBody.data.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось загрузить сайт';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const id = createProjectId();
  const slug = slugify(analysis.name);
  const bundleId = deriveBundleId('am.mobilio.app', slug);

  const configInput: ProjectConfigInput = {
    id,
    name: analysis.name,
    slug,
    bundleId,
    source: { type: 'url', url: analysis.url },
    theme: { primary: analysis.color, background: '#FFFFFF', statusBar: 'dark' },
    tabs: analysis.tabs,
    features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
    allowedDomains: [analysis.hostname],
    trial: true,
  };

  const parsedConfig = parseProjectConfig(configInput);
  if (!parsedConfig.success) {
    return NextResponse.json(
      { error: `Не удалось собрать конфигурацию: ${parsedConfig.errors.join('; ')}` },
      { status: 500 },
    );
  }

  await writeConfig(id, parsedConfig.data);
  await writeIcon(id, analysis.iconBuffer);

  return NextResponse.json({ id });
}
